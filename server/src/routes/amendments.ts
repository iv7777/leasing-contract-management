import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  amendments,
  contracts,
  contractUnits,
  pricingStreams,
  pricingStreamUnits,
  rateSchedule,
  concessions,
  depositTerms,
  chargeAdjustments,
  documents,
} from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordContractVersion } from "../lib/contractSnapshot.js";
import {
  contractUnitBelongsToContract,
  pricingStreamBelongsToContract,
  chargeBelongsToContract,
  rateScheduleBelongsToStream,
} from "../lib/ownership.js";
import { recordAudit } from "../lib/audit.js";
import { rateRuleError } from "../lib/rateRules.js";
import { citedDocumentIds, liveSignedLeaseIds } from "../lib/documentRules.js";
import { todayInChina } from "@lcm/shared";

export const amendmentsRouter = Router();
amendmentsRouter.use(requireAuth);

const decimalString = z.string().regex(/^\d+(\.\d+)?$/);

const changesSchema = z.object({
  contract: z
    .object({
      termEnd: z.string().optional(),
      renewalNoticeDays: z.number().optional(),
      specialTerms: z.string().optional(),
      status: z.enum(["active", "expired", "terminated"]).optional(),
    })
    .optional(),
  addUnits: z
    .array(
      z.object({
        unitId: z.number(),
        effectiveStart: z.string(),
        effectiveEnd: z.string().optional(),
        contractedAreaSqm: decimalString,
        notes: z.string().optional(),
      }),
    )
    .optional(),
  endUnits: z.array(z.object({ contractUnitId: z.number(), effectiveEnd: z.string() })).optional(),
  addPricingStreams: z
    .array(
      z.object({
        feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]),
        targetType: z.enum(["unit", "group", "contract"]),
        label: z.string().optional(),
        contractUnitIds: z.array(z.number()),
        initialRate: z.object({
          effectiveStart: z.string(),
          effectiveEnd: z.string().optional(),
          calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered", "usage_fee_per_unit", "usage_fee_percent"]),
          amountOrRate: decimalString,
          rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit", "percent_of_usage"]),
          escalationBase: z.enum(["initial", "previous"]).optional(),
          escalationPercentage: decimalString.optional(),
          escalationIntervalMonths: z.number().optional(),
          unit: z.string().optional(),
          linkedStreamId: z.number().optional(),
        }),
      }),
    )
    .optional(),
  addRateSchedule: z
    .array(
      z.object({
        pricingStreamId: z.number(),
        closePreviousRateScheduleId: z.number().optional(),
        effectiveStart: z.string(),
        effectiveEnd: z.string().optional(),
        calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered", "usage_fee_per_unit", "usage_fee_percent"]),
        amountOrRate: decimalString,
        rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit", "percent_of_usage"]),
        escalationBase: z.enum(["initial", "previous"]).optional(),
        escalationPercentage: decimalString.optional(),
        escalationIntervalMonths: z.number().optional(),
        unit: z.string().optional(),
        linkedStreamId: z.number().optional(),
      }),
    )
    .optional(),
  addConcessions: z
    .array(
      z.object({
        pricingStreamId: z.number().nullable(),
        effectiveStart: z.string(),
        effectiveEnd: z.string(),
        discountPercentage: decimalString,
        reason: z.string().optional(),
      }),
    )
    .optional(),
  addDepositTerms: z
    .array(
      z.object({
        effectiveStart: z.string(),
        requirementType: z.enum(["fixed", "formula"]),
        fixedAmountFen: z.number().optional(),
        formulaBasis: z.string().optional(),
        waiverConditionText: z.string().optional(),
        dueDate: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  retroactiveAdjustments: z
    .array(z.object({ chargeId: z.number(), amountFen: z.number(), reason: z.string() }))
    .optional(),
  // Withdraws documents from the contract's record: an approved amendment marks
  // each one voided (the file is kept). The only way to remove a document once
  // the contract has left draft.
  voidDocuments: z.array(z.number()).optional(),
});

const createAmendmentSchema = z.object({
  type: z.string().min(1),
  reason: z.string().min(1),
  effectiveDate: z.string(),
  changes: changesSchema,
  supportingDocumentId: z.number().optional(),
});

const DRAFT_AMENDMENT_MESSAGE = "A draft contract is edited directly. Amendments are for changing a contract after it has been activated.";

/** Every amendment except an internal correction needs a signed supplement or
 * similar on file, and that document must belong to this contract. */
function supportingDocumentError(contractId: number, type: string, documentId: number | null): { code: string; message: string } | null {
  if (documentId === null) {
    return type === "internal_correction"
      ? null
      : { code: "missing_document", message: "Pick the supporting document (a signed supplement, for example) — it is required unless this is an internal correction." };
  }
  const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!doc || doc.ownerType !== "contract" || doc.ownerId !== contractId || doc.voided) {
    return { code: "invalid_reference", message: "That document does not belong to this contract." };
  }
  return null;
}

/** A void-document amendment may only name this contract's own live documents,
 * never evidence another amendment (or itself) relies on, and never the last
 * signed lease. */
function voidDocumentsError(contractId: number, ids: number[], ownSupportingDocumentId: number | null): { code: string; message: string } | null {
  if (ids.length === 0) return null;
  const cited = citedDocumentIds(contractId);
  if (ownSupportingDocumentId !== null) cited.add(ownSupportingDocumentId);
  for (const docId of ids) {
    const doc = db.select().from(documents).where(eq(documents.id, docId)).get();
    if (!doc || doc.ownerType !== "contract" || doc.ownerId !== contractId) {
      return { code: "invalid_reference", message: `Document ${docId} does not belong to this contract.` };
    }
    if (doc.voided) return { code: "document_voided", message: "That document has already been voided." };
    if (cited.has(docId)) {
      return { code: "document_in_use_by_amendment", message: "An amendment relies on this document as its supporting document, so it can't be voided." };
    }
  }
  const remaining = liveSignedLeaseIds(contractId).filter((id) => !ids.includes(id));
  if (liveSignedLeaseIds(contractId).some((id) => ids.includes(id)) && remaining.length === 0) {
    return { code: "last_signed_lease", message: "This would void the only signed lease on file. Upload the replacement signed lease first." };
  }
  return null;
}

amendmentsRouter.get("/contracts/:contractId/amendments", (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const rows = db.select().from(amendments).where(eq(amendments.contractId, contractId)).all();
  res.json({ amendments: rows });
});

amendmentsRouter.post("/contracts/:contractId/amendments", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.contractId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }

  if (rejectIfDraft(res, contractId, DRAFT_AMENDMENT_MESSAGE)) return;

  const parsed = createAmendmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid amendment payload.", details: parsed.error.flatten() } });
  }

  const docError = supportingDocumentError(contractId, parsed.data.type, parsed.data.supportingDocumentId ?? null);
  if (docError) return res.status(400).json({ error: docError });
  const voidError = voidDocumentsError(contractId, parsed.data.changes.voidDocuments ?? [], parsed.data.supportingDocumentId ?? null);
  if (voidError) return res.status(409).json({ error: voidError });
  const referenceError = validateAmendmentReferences(parsed.data.changes, contractId);
  if (referenceError) return res.status(400).json({ error: { code: "invalid_rate", message: referenceError } });

  const inserted = db
    .insert(amendments)
    .values({
      contractId,
      type: parsed.data.type,
      reason: parsed.data.reason,
      effectiveDate: parsed.data.effectiveDate,
      baseContractVersion: contract.versionNumber,
      createdBy: req.user!.id,
      changesJson: JSON.stringify(parsed.data.changes),
      supportingDocumentId: parsed.data.supportingDocumentId ?? null,
      status: "draft",
    })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "amendment_drafted", entityType: "amendment", entityId: inserted.id, reason: parsed.data.reason });
  res.status(201).json({ amendment: inserted });
});

// A draft can still be corrected before it is submitted — typically to attach
// the supporting document, or to mark it as an internal correction. Its
// changes (and so its effective date) stay as drafted; to change those,
// withdraw it and propose a new one.
const updateAmendmentSchema = z.object({
  reason: z.string().min(1).optional(),
  internalCorrection: z.boolean().optional(),
  supportingDocumentId: z.number().nullable().optional(),
});

amendmentsRouter.patch("/amendments/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const amendment = db.select().from(amendments).where(eq(amendments.id, id)).get();
  if (!amendment) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (!canAccessContract(req.user!, amendment.contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  if (amendment.status !== "draft") {
    return res.status(409).json({ error: { code: "invalid_state", message: "Only a draft amendment can be edited." } });
  }
  // A draft belongs to whoever drafted it (drafts from before this was recorded stay open to any Manager).
  if (req.user!.role !== "admin" && amendment.createdBy !== null && amendment.createdBy !== req.user!.id) {
    return res.status(403).json({ error: { code: "forbidden", message: "Only the person who drafted this amendment, or an Admin, can edit it." } });
  }
  const parsed = updateAmendmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid amendment payload." } });

  const { internalCorrection, ...fields } = parsed.data;
  // Marking or unmarking an internal correction swaps the type between
  // "internal_correction" and the kind of change the amendment actually makes.
  let type = amendment.type;
  if (internalCorrection === true) type = "internal_correction";
  if (internalCorrection === false && amendment.type === "internal_correction") type = inferAmendmentType(amendment.changesJson);
  const supportingDocumentId = fields.supportingDocumentId === undefined ? amendment.supportingDocumentId : fields.supportingDocumentId;
  const docError = supportingDocumentError(amendment.contractId, type, supportingDocumentId);
  if (docError) return res.status(400).json({ error: docError });

  const updated = db
    .update(amendments)
    .set({ type, supportingDocumentId, ...(fields.reason ? { reason: fields.reason } : {}) })
    .where(eq(amendments.id, id))
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "amendment_updated", entityType: "amendment", entityId: id, details: { type, supportingDocumentId } });
  res.json({ amendment: updated });
});

/** The kind of change an amendment makes, read back from its changes. */
function inferAmendmentType(changesJson: string): string {
  try {
    const c = JSON.parse(changesJson) as Record<string, { status?: string } | unknown[] | undefined>;
    if ((c.contract as { status?: string } | undefined)?.status === "terminated") return "terminate";
    if (Array.isArray(c.voidDocuments) && c.voidDocuments.length) return "void_document";
    if (Array.isArray(c.addUnits) && c.addUnits.length) return "add_unit";
    if (Array.isArray(c.addPricingStreams) && c.addPricingStreams.length) return "add_pricing_stream";
  } catch {
    // fall through
  }
  return "rent_change";
}

amendmentsRouter.post("/amendments/:id/submit", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const amendment = db.select().from(amendments).where(eq(amendments.id, id)).get();
  if (!amendment) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (amendment.status !== "draft") {
    return res.status(409).json({ error: { code: "invalid_state", message: "Only a draft amendment can be submitted." } });
  }
  if (rejectIfDraft(res, amendment.contractId, DRAFT_AMENDMENT_MESSAGE)) return;

  const isInternalCorrection = amendment.type === "internal_correction";
  if (!isInternalCorrection && !amendment.supportingDocumentId) {
    return res
      .status(409)
      .json({ error: { code: "missing_document", message: "A signed supplement is required before submitting this amendment for review." } });
  }

  const updated = db
    .update(amendments)
    .set({ status: "pending", submittedBy: req.user!.id, submittedAt: new Date().toISOString() })
    .where(eq(amendments.id, id))
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "amendment_submitted", entityType: "amendment", entityId: id });

  // An Admin's own changes use the same mechanism and may be auto-approved.
  if (req.user!.role === "admin") {
    return applyApproval(req, res, updated.id, "Auto-approved: submitted by Admin.");
  }
  res.json({ amendment: updated });
});

amendmentsRouter.post("/amendments/:id/approve", requireRole("admin"), (req, res) => {
  applyApproval(req, res, Number(req.params.id), (req.body?.reviewReason as string) ?? null);
});

function applyApproval(req: import("express").Request, res: import("express").Response, amendmentId: number, reviewReason: string | null) {
  const amendment = db.select().from(amendments).where(eq(amendments.id, amendmentId)).get();
  if (!amendment) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (amendment.status !== "pending") {
    return res.status(409).json({ error: { code: "invalid_state", message: "Only a pending amendment can be approved." } });
  }

  const contract = db.select().from(contracts).where(eq(contracts.id, amendment.contractId)).get()!;
  if (rejectIfDraft(res, amendment.contractId, DRAFT_AMENDMENT_MESSAGE)) return;
  if (amendment.baseContractVersion !== contract.versionNumber) {
    return res.status(409).json({
      error: {
        code: "stale_amendment",
        message: "The contract has changed since this amendment was proposed. Refresh and resubmit.",
      },
    });
  }

  const changes = JSON.parse(amendment.changesJson) as z.infer<typeof changesSchema>;

  const referenceError = validateAmendmentReferences(changes, contract.id);
  if (referenceError) {
    return res.status(400).json({ error: { code: "invalid_reference", message: referenceError } });
  }
  const voidError = voidDocumentsError(contract.id, changes.voidDocuments ?? [], amendment.supportingDocumentId);
  if (voidError) return res.status(409).json({ error: voidError });

  db.transaction((tx) => {
    if (changes.contract) {
      // Term changes apply at once, but a status change (e.g. an early
      // termination) waits for the amendment's effective date; the nightly
      // job in jobs/contractLifecycle.ts applies it then.
      const { status: requestedStatus, ...termChanges } = changes.contract;
      const statusNow = requestedStatus !== undefined && amendment.effectiveDate <= todayInChina() ? { status: requestedStatus } : {};
      const set = { ...termChanges, ...statusNow };
      if (Object.keys(set).length > 0) {
        tx.update(contracts).set({ ...set, updatedAt: new Date().toISOString() }).where(eq(contracts.id, contract.id)).run();
      }
    }
    for (const u of changes.addUnits ?? []) {
      tx.insert(contractUnits).values({ contractId: contract.id, ...u }).run();
    }
    for (const eu of changes.endUnits ?? []) {
      tx.update(contractUnits).set({ effectiveEnd: eu.effectiveEnd }).where(eq(contractUnits.id, eu.contractUnitId)).run();
    }
    for (const s of changes.addPricingStreams ?? []) {
      const { contractUnitIds, initialRate, ...streamFields } = s;
      const stream = tx.insert(pricingStreams).values({ contractId: contract.id, ...streamFields }).returning().get();
      for (const contractUnitId of contractUnitIds) {
        tx.insert(pricingStreamUnits).values({ pricingStreamId: stream.id, contractUnitId }).run();
      }
      tx.insert(rateSchedule).values({ pricingStreamId: stream.id, ...initialRate }).run();
    }
    for (const r of changes.addRateSchedule ?? []) {
      const { closePreviousRateScheduleId, ...rateFields } = r;
      if (closePreviousRateScheduleId) {
        const dayBefore = addDaysIso(r.effectiveStart, -1);
        tx.update(rateSchedule).set({ effectiveEnd: dayBefore }).where(eq(rateSchedule.id, closePreviousRateScheduleId)).run();
      }
      tx.insert(rateSchedule).values(rateFields).run();
    }
    for (const c of changes.addConcessions ?? []) {
      tx.insert(concessions).values({ contractId: contract.id, ...c }).run();
    }
    for (const d of changes.addDepositTerms ?? []) {
      tx.insert(depositTerms).values({ contractId: contract.id, ...d }).run();
    }
    for (const docId of changes.voidDocuments ?? []) {
      tx.update(documents).set({ voided: true, voidedAt: new Date().toISOString(), voidedByAmendmentId: amendment.id }).where(eq(documents.id, docId)).run();
      recordAudit({ actorUserId: req.user!.id, action: "document_voided", entityType: "document", entityId: docId, reason: amendment.reason, details: { amendmentId: amendment.id } });
    }
    for (const adj of changes.retroactiveAdjustments ?? []) {
      tx.insert(chargeAdjustments).values({
        chargeId: adj.chargeId,
        amountFen: adj.amountFen,
        reason: adj.reason,
        sourceAmendmentId: amendment.id,
        actorUserId: req.user!.id,
      }).run();
    }

    const newVersion = contract.versionNumber + 1;
    tx.update(contracts).set({ versionNumber: newVersion, updatedAt: new Date().toISOString() }).where(eq(contracts.id, contract.id)).run();
    tx.update(amendments)
      .set({ status: "approved", reviewedBy: req.user!.id, reviewedAt: new Date().toISOString(), reviewReason })
      .where(eq(amendments.id, amendment.id))
      .run();
  });

  recordContractVersion(contract.id, contract.versionNumber + 1, amendment.effectiveDate, amendment.id);
  recordAudit({ actorUserId: req.user!.id, action: "amendment_approved", entityType: "amendment", entityId: amendment.id, reason: reviewReason });

  const updatedAmendment = db.select().from(amendments).where(eq(amendments.id, amendment.id)).get();
  res.json({ amendment: updatedAmendment });
}

/** Every child-entity ID inside an approved amendment must actually belong
 * to the contract being amended — an amendment's JSON payload is untrusted
 * input from whoever drafted it, and approving it must not be able to
 * mutate a different contract's units, pricing, or charges just because a
 * plausible-looking numeric ID was included. Checked once, before the
 * transaction starts, so a bad reference rejects the whole approval rather
 * than partially applying it. */
function validateAmendmentReferences(changes: z.infer<typeof changesSchema>, contractId: number): string | null {
  for (const eu of changes.endUnits ?? []) {
    if (!contractUnitBelongsToContract(eu.contractUnitId, contractId)) {
      return `Contract unit ${eu.contractUnitId} does not belong to this contract.`;
    }
  }
  for (const s of changes.addPricingStreams ?? []) {
    for (const cuId of s.contractUnitIds) {
      if (!contractUnitBelongsToContract(cuId, contractId)) {
        return `Contract unit ${cuId} does not belong to this contract.`;
      }
    }
    const rateError = rateRuleError(s.initialRate, contractId, null);
    if (rateError) return rateError;
  }
  for (const r of changes.addRateSchedule ?? []) {
    if (!pricingStreamBelongsToContract(r.pricingStreamId, contractId)) {
      return `Pricing stream ${r.pricingStreamId} does not belong to this contract.`;
    }
    if (r.closePreviousRateScheduleId && !rateScheduleBelongsToStream(r.closePreviousRateScheduleId, r.pricingStreamId)) {
      return `Rate schedule ${r.closePreviousRateScheduleId} does not belong to pricing stream ${r.pricingStreamId}.`;
    }
    const rateError = rateRuleError(r, contractId, r.pricingStreamId);
    if (rateError) return rateError;
  }
  for (const c of changes.addConcessions ?? []) {
    if (c.pricingStreamId !== null && !pricingStreamBelongsToContract(c.pricingStreamId, contractId)) {
      return `Pricing stream ${c.pricingStreamId} does not belong to this contract.`;
    }
  }
  for (const adj of changes.retroactiveAdjustments ?? []) {
    if (!chargeBelongsToContract(adj.chargeId, contractId)) {
      return `Charge ${adj.chargeId} does not belong to this contract.`;
    }
  }
  return null;
}

function addDaysIso(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

amendmentsRouter.post("/amendments/:id/reject", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const amendment = db.select().from(amendments).where(eq(amendments.id, id)).get();
  if (!amendment) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (amendment.status !== "pending") {
    return res.status(409).json({ error: { code: "invalid_state", message: "Only a pending amendment can be rejected." } });
  }
  const reviewReason = req.body?.reviewReason as string | undefined;
  if (!reviewReason) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required to reject an amendment." } });

  const updated = db
    .update(amendments)
    .set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date().toISOString(), reviewReason })
    .where(eq(amendments.id, id))
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "amendment_rejected", entityType: "amendment", entityId: id, reason: reviewReason });
  res.json({ amendment: updated });
});

amendmentsRouter.post("/amendments/:id/withdraw", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const amendment = db.select().from(amendments).where(eq(amendments.id, id)).get();
  if (!amendment) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (amendment.status !== "draft" && amendment.status !== "pending") {
    return res.status(409).json({ error: { code: "invalid_state", message: "Only a draft or pending amendment can be withdrawn." } });
  }
  if (req.user!.role !== "admin" && amendment.submittedBy !== req.user!.id && amendment.createdBy !== req.user!.id) {
    return res.status(403).json({ error: { code: "forbidden", message: "Only the person who drafted or submitted this amendment, or an Admin, can withdraw it." } });
  }

  const updated = db.update(amendments).set({ status: "withdrawn" }).where(eq(amendments.id, id)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "amendment_withdrawn", entityType: "amendment", entityId: id });
  res.json({ amendment: updated });
});
