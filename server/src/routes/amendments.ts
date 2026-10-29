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
  billingRules,
  contractVersions,
  users,
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
import { amendmentFacts, contractRef } from "../lib/auditDetail.js";
import { summarizeAmendment } from "../lib/amendmentSummary.js";
import { rateRuleError } from "../lib/rateRules.js";
import { citedDocumentIds, liveSignedLeaseIds } from "../lib/documentRules.js";
import { isoDate, fenAmount, longText, decimalString, percentString } from "../lib/validate.js";
import { MSG, dateOrderError, rateShapeError, rateOverlapError, concessionError, depositTermError, contractUnitError } from "../lib/contractRules.js";
import { todayInChina } from "@lcm/shared";

export const amendmentsRouter = Router();
amendmentsRouter.use(requireAuth);


const changesSchema = z.object({
  contract: z
    .object({
      termEnd: isoDate.optional(),
      renewalNoticeDays: z.number().int().min(0).max(365).optional(),
      specialTerms: longText(20000).optional(),
      status: z.enum(["active", "expired", "terminated"]).optional(),
    })
    .optional(),
  addUnits: z
    .array(
      z.object({
        unitId: z.number().int(),
        effectiveStart: isoDate,
        effectiveEnd: isoDate.optional(),
        contractedAreaSqm: decimalString,
        notes: longText().optional(),
      }),
    )
    .optional(),
  endUnits: z.array(z.object({ contractUnitId: z.number().int(), effectiveEnd: isoDate })).optional(),
  addPricingStreams: z
    .array(
      z.object({
        feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]),
        targetType: z.enum(["unit", "group", "contract"]),
        label: z.string().trim().max(100).optional(),
        contractUnitIds: z.array(z.number().int()),
        initialRate: z.object({
          effectiveStart: isoDate,
          effectiveEnd: isoDate.optional(),
          calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered", "metered_amount", "usage_fee_per_unit", "usage_fee_percent"]),
          amountOrRate: decimalString,
          rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit", "percent_of_usage"]),
          escalationBase: z.enum(["initial", "previous"]).optional(),
          escalationPercentage: decimalString.optional(),
          escalationIntervalMonths: z.number().int().min(1).max(120).optional(),
          unit: z.string().trim().min(1).max(20).optional(),
          linkedStreamId: z.number().int().optional(),
        }),
      }),
    )
    .optional(),
  addRateSchedule: z
    .array(
      z.object({
        pricingStreamId: z.number().int(),
        closePreviousRateScheduleId: z.number().int().optional(),
        effectiveStart: isoDate,
        effectiveEnd: isoDate.optional(),
        calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered", "metered_amount", "usage_fee_per_unit", "usage_fee_percent"]),
        amountOrRate: decimalString,
        rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit", "percent_of_usage"]),
        escalationBase: z.enum(["initial", "previous"]).optional(),
        escalationPercentage: decimalString.optional(),
        escalationIntervalMonths: z.number().int().min(1).max(120).optional(),
        unit: z.string().trim().min(1).max(20).optional(),
        linkedStreamId: z.number().int().optional(),
      }),
    )
    .optional(),
  addConcessions: z
    .array(
      z.object({
        pricingStreamId: z.number().int().nullable(),
        effectiveStart: isoDate,
        effectiveEnd: isoDate,
        discountPercentage: percentString,
        reason: longText(500).optional(),
      }),
    )
    .optional(),
  addDepositTerms: z
    .array(
      z.object({
        effectiveStart: isoDate,
        requirementType: z.enum(["fixed", "formula"]),
        fixedAmountFen: fenAmount.optional(),
        formulaBasis: longText(500).optional(),
        waiverConditionText: longText(2000).optional(),
        dueDate: isoDate.optional(),
        notes: longText().optional(),
      }),
    )
    .optional(),
  retroactiveAdjustments: z
    .array(z.object({ chargeId: z.number().int(), amountFen: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000), reason: z.string().min(1).max(500) }))
    .optional(),
  // Due-date and late-fee rules can be changed on a live contract too, by amendment.
  billingRules: z
    .object({
      dueDay: z.number().int().min(1).max(31).optional(),
      dueMonthOffset: z.number().int().min(-12).max(12).optional(),
      overdueGraceDays: z.number().int().min(0).max(60).optional(),
    })
    .optional(),
  latePenaltyRules: z
    .object({
      latePenaltyEnabled: z.boolean(),
      latePenaltyDailyRatePermille: decimalString.refine((v) => Number(v) <= 100, "Can't be more than 100 per mille a day.").optional(),
      latePenaltyCapFen: fenAmount.optional(),
    })
    .optional(),
  // Withdraws documents from the contract's record: an approved amendment marks
  // each one voided (the file is kept). The only way to remove a document once
  // the contract has left draft.
  voidDocuments: z.array(z.number().int()).optional(),
});

const createAmendmentSchema = z.object({
  type: z.enum(["rate_change", "add_unit", "add_pricing_stream", "terminate", "void_document", "internal_correction", "billing_rules", "rent_change"]),
  reason: z.string().trim().min(1).max(1000),
  effectiveDate: isoDate,
  changes: changesSchema,
  supportingDocumentId: z.number().int().optional(),
});

/** The facts every amendment event carries, plus what the amendment changes (shown as old → new in the audit log). */
function amendmentAuditDetails(a: typeof amendments.$inferSelect) {
  return { ...amendmentFacts(a), amendmentId: a.id, amendmentLines: summarizeAmendment(a) };
}

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
  // Each amendment says what it changes (old → new), so the list is useful without opening it.
  res.json({ amendments: rows.map((a) => ({ ...a, lines: summarizeAmendment(a) })) });
});

/** One amendment with everything about it: who did what and when, its supporting document, the contract version
 * it created, and what it changes. */
amendmentsRouter.get("/amendments/:id", (req, res) => {
  const id = Number(req.params.id);
  const a = db.select().from(amendments).where(eq(amendments.id, id)).get();
  if (!a) return res.status(404).json({ error: { code: "not_found", message: "Amendment not found." } });
  if (!canAccessContract(req.user!, a.contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
  const who = (uid: number | null) => (uid === null ? null : names.get(uid) ?? null);
  const doc = a.supportingDocumentId ? db.select().from(documents).where(eq(documents.id, a.supportingDocumentId)).get() : null;
  const version = db.select().from(contractVersions).where(eq(contractVersions.sourceAmendmentId, id)).get();
  res.json({
    amendment: {
      id: a.id,
      contractId: a.contractId,
      contractRef: contractRef(a.contractId),
      type: a.type,
      status: a.status,
      reason: a.reason,
      effectiveDate: a.effectiveDate,
      baseContractVersion: a.baseContractVersion,
      newVersion: version?.versionNumber ?? null,
      createdAt: a.createdAt,
      createdBy: who(a.createdBy),
      submittedAt: a.submittedAt,
      submittedBy: who(a.submittedBy),
      reviewedAt: a.reviewedAt,
      reviewedBy: who(a.reviewedBy),
      reviewReason: a.reviewReason,
      supportingDocument: doc ? { id: doc.id, docType: doc.docType, name: doc.name, voided: doc.voided } : null,
    },
    lines: summarizeAmendment(a),
  });
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
  if (parsed.success && contract.status !== "active" && parsed.data.type !== "internal_correction") {
    return res.status(409).json({ error: { code: "contract_ended", message: "This contract has ended. Only an internal correction can still be recorded on it." } });
  }
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

  recordAudit({ actorUserId: req.user!.id, action: "amendment_drafted", entityType: "amendment", entityId: inserted.id, reason: parsed.data.reason, details: amendmentAuditDetails(inserted) });
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
  // A draft belongs to whoever drafted it.
  if (req.user!.role !== "admin" && amendment.createdBy !== req.user!.id) {
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
  recordAudit({ actorUserId: req.user!.id, action: "amendment_updated", entityType: "amendment", entityId: id, details: { ...amendmentAuditDetails(updated), supportingDocumentId } });
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
    if (c.billingRules || c.latePenaltyRules) return "billing_rules";
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

  recordAudit({ actorUserId: req.user!.id, action: "amendment_submitted", entityType: "amendment", entityId: id, details: amendmentAuditDetails(updated) });

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
      // An early termination ends the contract on its effective date, so that date becomes its end.
      const endNow = (statusNow as { status?: string }).status === "terminated" && amendment.effectiveDate < (termChanges.termEnd ?? contract.termEnd) ? { termEnd: amendment.effectiveDate } : {};
      const set = { ...termChanges, ...statusNow, ...endNow };
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
        const replaced = tx.select().from(rateSchedule).where(eq(rateSchedule.id, closePreviousRateScheduleId)).get();
        tx.update(rateSchedule).set({ effectiveEnd: dayBefore }).where(eq(rateSchedule.id, closePreviousRateScheduleId)).run();
        // The new rate takes over for the rest of the period of the rate it replaces; later steps stay as they are.
        if (replaced?.effectiveEnd && !rateFields.effectiveEnd) rateFields.effectiveEnd = replaced.effectiveEnd;
      }
      tx.insert(rateSchedule).values(rateFields).run();
    }
    for (const c of changes.addConcessions ?? []) {
      tx.insert(concessions).values({ contractId: contract.id, ...c }).run();
    }
    for (const d of changes.addDepositTerms ?? []) {
      tx.insert(depositTerms).values({ contractId: contract.id, ...d }).run();
    }
    if (changes.billingRules && Object.keys(changes.billingRules).length > 0) {
      tx.update(billingRules).set(changes.billingRules).where(eq(billingRules.contractId, contract.id)).run();
    }
    if (changes.latePenaltyRules) {
      tx.update(billingRules).set(changes.latePenaltyRules).where(eq(billingRules.contractId, contract.id)).run();
    }
    for (const docId of changes.voidDocuments ?? []) {
      tx.update(documents).set({ voided: true, voidedAt: new Date().toISOString(), voidedByAmendmentId: amendment.id }).where(eq(documents.id, docId)).run();
      recordAudit({ actorUserId: req.user!.id, action: "document_voided", entityType: "document", entityId: docId, reason: amendment.reason, details: { contract: contractRef(contract.id), amendmentId: amendment.id } });
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
  recordAudit({ actorUserId: req.user!.id, action: "amendment_approved", entityType: "amendment", entityId: amendment.id, reason: reviewReason, details: { ...amendmentAuditDetails(amendment), newVersion: contract.versionNumber + 1 } });

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
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (contract && changes.contract?.termEnd) {
    const orderError = dateOrderError(contract.termStart, changes.contract.termEnd);
    if (orderError) return orderError;
  }
  for (const eu of changes.endUnits ?? []) {
    if (!contractUnitBelongsToContract(eu.contractUnitId, contractId)) {
      return `Contract unit ${eu.contractUnitId} does not belong to this contract.`;
    }
    const cu = db.select().from(contractUnits).where(eq(contractUnits.id, eu.contractUnitId)).get();
    const orderError = cu ? dateOrderError(cu.effectiveStart, eu.effectiveEnd) : null;
    if (orderError) return orderError;
  }
  for (const u of changes.addUnits ?? []) {
    const unitError = contractUnitError(contractId, u.unitId, u.contractedAreaSqm, u.effectiveStart, u.effectiveEnd);
    if (unitError) return unitError;
  }
  for (const s of changes.addPricingStreams ?? []) {
    for (const cuId of s.contractUnitIds) {
      if (!contractUnitBelongsToContract(cuId, contractId)) {
        return `Contract unit ${cuId} does not belong to this contract.`;
      }
    }
    const rateError = rateRuleError(s.initialRate, contractId, null) ?? rateShapeError(s.initialRate);
    if (rateError) return rateError;
    if (s.initialRate.rateBasis === "per_sqm_per_month" && s.contractUnitIds.length === 0) return MSG.perSqmNeedsUnits;
  }
  for (const r of changes.addRateSchedule ?? []) {
    if (!pricingStreamBelongsToContract(r.pricingStreamId, contractId)) {
      return `Pricing stream ${r.pricingStreamId} does not belong to this contract.`;
    }
    if (r.closePreviousRateScheduleId && !rateScheduleBelongsToStream(r.closePreviousRateScheduleId, r.pricingStreamId)) {
      return `Rate schedule ${r.closePreviousRateScheduleId} does not belong to pricing stream ${r.pricingStreamId}.`;
    }
    let inheritedEnd: string | null | undefined = r.effectiveEnd;
    if (r.closePreviousRateScheduleId) {
      const replaced = db.select().from(rateSchedule).where(eq(rateSchedule.id, r.closePreviousRateScheduleId)).get();
      if (replaced) {
        if (r.effectiveStart <= replaced.effectiveStart) return `The new rate must start after the rate it replaces begins (${replaced.effectiveStart}).`;
        if (replaced.effectiveEnd && r.effectiveStart > replaced.effectiveEnd) return `The new rate must start within the rate it replaces (which runs until ${replaced.effectiveEnd}).`;
        inheritedEnd = inheritedEnd ?? replaced.effectiveEnd;
      }
    }
    const rateError = rateRuleError(r, contractId, r.pricingStreamId) ?? rateShapeError({ ...r, effectiveEnd: inheritedEnd });
    if (rateError) return rateError;
    const dayBefore = addDaysIso(r.effectiveStart, -1);
    const others = db
      .select()
      .from(rateSchedule)
      .where(eq(rateSchedule.pricingStreamId, r.pricingStreamId))
      .all()
      .map((o) => (o.id === r.closePreviousRateScheduleId ? { ...o, effectiveEnd: dayBefore } : o));
    const overlapError = rateOverlapError(others, { ...r, effectiveEnd: inheritedEnd });
    if (overlapError) return overlapError;
    if (r.rateBasis === "per_sqm_per_month" && !db.select().from(pricingStreamUnits).where(eq(pricingStreamUnits.pricingStreamId, r.pricingStreamId)).get()) return MSG.perSqmNeedsUnits;
  }
  for (const c of changes.addConcessions ?? []) {
    if (c.pricingStreamId !== null && !pricingStreamBelongsToContract(c.pricingStreamId, contractId)) {
      return `Pricing stream ${c.pricingStreamId} does not belong to this contract.`;
    }
    const concessionErr = concessionError(c);
    if (concessionErr) return concessionErr;
  }
  for (const d of changes.addDepositTerms ?? []) {
    const depositErr = depositTermError(d);
    if (depositErr) return depositErr;
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
  recordAudit({ actorUserId: req.user!.id, action: "amendment_rejected", entityType: "amendment", entityId: id, reason: reviewReason, details: amendmentAuditDetails(updated) });
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
  recordAudit({ actorUserId: req.user!.id, action: "amendment_withdrawn", entityType: "amendment", entityId: id, details: amendmentAuditDetails(updated) });
  res.json({ amendment: updated });
});
