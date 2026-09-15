import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contracts,
  contractUnits,
  billingRules,
  pricingStreams,
  pricingStreamUnits,
  rateSchedule,
  concessions,
  depositTerms,
  charges,
  receipts,
  depositTransactions,
  units,
  parties,
  documents as documentsTable,
  amendments,
  contractVersions,
  usageEntries,
} from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getContractPropertyIds, canAccessContract } from "../lib/contractScope.js";
import { contractUnitBelongsToContract, pricingStreamBelongsToContract, rateScheduleBelongsToStream } from "../lib/ownership.js";
import { recordAudit } from "../lib/audit.js";
import { generateChargesForContractMonth } from "../billing/generate.js";
import { recordContractVersion } from "../lib/contractSnapshot.js";
import { previewEscalationTiers } from "../billing/chargeEngine.js";
import { computeMonthlyStatement } from "../billing/ledger.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { daysInMonth } from "@lcm/shared";

export const contractsRouter = Router();
contractsRouter.use(requireAuth);

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a decimal number");

function requireDraft(contract: typeof contracts.$inferSelect, res: import("express").Response): boolean {
  if (contract.status !== "draft") {
    res
      .status(409)
      .json({ error: { code: "not_draft", message: "Direct edits are only allowed while a contract is in draft status; use an amendment instead." } });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

contractsRouter.get("/", (req, res) => {
  const all = db.select().from(contracts).all();
  const visible = all.filter((c) => canAccessContract(req.user!, c.id));

  const cUnitRows = db.select().from(contractUnits).all();
  const unitIds = Array.from(new Set(cUnitRows.map((cu) => cu.unitId)));
  const unitById = new Map(
    (unitIds.length ? db.select().from(units).all().filter((u) => unitIds.includes(u.id)) : []).map((u) => [u.id, u]),
  );

  const unitLabelsByContract: Record<number, string[]> = {};
  for (const cu of cUnitRows) {
    const unit = unitById.get(cu.unitId);
    if (!unit) continue;
    (unitLabelsByContract[cu.contractId] ??= []).push(unit.unitLabel);
  }

  res.json({
    contracts: visible.map((c) => ({ ...c, unitLabels: unitLabelsByContract[c.id] ?? [] })),
  });
});

const createContractSchema = z.object({
  referenceNumber: z.string().min(1),
  landlordPartyId: z.number(),
  tenantPartyId: z.number(),
  termStart: z.string(),
  termEnd: z.string(),
  renewalNoticeDays: z.number().optional(),
  specialTerms: z.string().nullable().optional(),
  billingRules: z.object({
    billingFrequency: z.enum(["monthly", "quarterly", "yearly"]).default("monthly"),
    periodAnchorDay: z.number().default(1),
    dueDay: z.number(),
    dueMonthOffset: z.number().default(0),
  }),
});

contractsRouter.post("/", requireRole("admin", "manager"), (req, res) => {
  const parsed = createContractSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid contract payload.", details: parsed.error.flatten() } });
  }
  const { billingRules: rulesInput, ...contractFields } = parsed.data;

  const inserted = db.insert(contracts).values(contractFields).returning().get();
  db.insert(billingRules).values({ contractId: inserted.id, ...rulesInput }).run();

  recordAudit({ actorUserId: req.user!.id, action: "contract_created", entityType: "contract", entityId: inserted.id });
  res.status(201).json({ contract: inserted });
});

contractsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!canAccessContract(req.user!, id)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }

  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, id)).get();
  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, id)).all();
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, id)).all();
  const streamIds = streams.map((s) => s.id);
  const streamUnits = streamIds.length ? db.select().from(pricingStreamUnits).all().filter((r) => streamIds.includes(r.pricingStreamId)) : [];
  const rates = streamIds.length ? db.select().from(rateSchedule).all().filter((r) => streamIds.includes(r.pricingStreamId)) : [];
  const contractConcessions = db.select().from(concessions).where(eq(concessions.contractId, id)).all();
  const deposits = db.select().from(depositTerms).where(eq(depositTerms.contractId, id)).all();

  res.json({
    contract,
    billingRules: rules,
    units: cUnits,
    pricingStreams: streams,
    pricingStreamUnits: streamUnits,
    rateSchedule: rates,
    concessions: contractConcessions,
    depositTerms: deposits,
    propertyIds: getContractPropertyIds(id),
  });
});

const updateContractSchema = z.object({
  referenceNumber: z.string().min(1).optional(),
  landlordPartyId: z.number().optional(),
  tenantPartyId: z.number().optional(),
  termStart: z.string().optional(),
  termEnd: z.string().optional(),
  renewalNoticeDays: z.number().optional(),
  // nullable because the column is nullable: an edit form re-submits a
  // previously-null value as null, not as "the field was omitted".
  specialTerms: z.string().nullable().optional(),
});

contractsRouter.patch("/:id", requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = updateContractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid contract payload." } });

  for (const partyId of [parsed.data.landlordPartyId, parsed.data.tenantPartyId]) {
    if (partyId !== undefined && !db.select().from(parties).where(eq(parties.id, partyId)).get()) {
      return res.status(400).json({ error: { code: "invalid_reference", message: `Party ${partyId} not found.` } });
    }
  }

  const updated = db
    .update(contracts)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(contracts.id, id))
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "contract_updated", entityType: "contract", entityId: id, details: { before: contract, after: updated } });
  res.json({ contract: updated });
});

contractsRouter.delete("/:id", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  // A draft can still have had charges/receipts/deposit activity recorded
  // against it (nothing here currently requires "active" first) — never
  // let a delete make financial history vanish.
  const hasCharges = db.select().from(charges).where(eq(charges.contractId, id)).get();
  const hasReceipts = db.select().from(receipts).where(eq(receipts.contractId, id)).get();
  const hasDepositTxns = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, id)).get();
  if (hasCharges || hasReceipts || hasDepositTxns) {
    return res.status(409).json({ error: { code: "has_financial_activity", message: "This draft has charges, receipts, or deposit transactions and cannot be deleted." } });
  }

  // Docs to unlink from disk once the transaction that removes their rows
  // has actually committed — never delete the file first, since a failure
  // partway through the transaction would leave the row referencing a file
  // that's already gone.
  const docs = db.select().from(documentsTable).where(eq(documentsTable.ownerType, "contract")).all().filter((d) => d.ownerId === id);

  db.transaction(() => {
    // Change-control history: a draft can still have amendments proposed
    // against it even before activation (nothing currently requires
    // "active" first). Not financial activity, so unlike charges/receipts
    // above we don't block on it — but every row referencing this contract
    // must be removed, in dependency order, before the contract row itself,
    // and before the documents loop below (an amendment can point at one of
    // this contract's own documents as supporting evidence).
    db.delete(usageEntries).where(eq(usageEntries.contractId, id)).run();
    db.delete(contractVersions).where(eq(contractVersions.contractId, id)).run();
    db.delete(amendments).where(eq(amendments.contractId, id)).run();

    // concessions.pricing_stream_id references pricing_streams.id, so it
    // must go before the pricing streams themselves are deleted below.
    db.delete(concessions).where(eq(concessions.contractId, id)).run();

    const streamIds = db.select({ id: pricingStreams.id }).from(pricingStreams).where(eq(pricingStreams.contractId, id)).all().map((s) => s.id);
    for (const streamId of streamIds) {
      db.delete(rateSchedule).where(eq(rateSchedule.pricingStreamId, streamId)).run();
      db.delete(pricingStreamUnits).where(eq(pricingStreamUnits.pricingStreamId, streamId)).run();
    }
    db.delete(pricingStreams).where(eq(pricingStreams.contractId, id)).run();
    db.delete(depositTerms).where(eq(depositTerms.contractId, id)).run();
    db.delete(contractUnits).where(eq(contractUnits.contractId, id)).run();
    db.delete(billingRules).where(eq(billingRules.contractId, id)).run();

    for (const doc of docs) {
      db.delete(documentsTable).where(eq(documentsTable.id, doc.id)).run();
    }

    db.delete(contracts).where(eq(contracts.id, id)).run();
    recordAudit({ actorUserId: req.user!.id, action: "contract_deleted", entityType: "contract", entityId: id, details: { referenceNumber: contract.referenceNumber } });
  });

  for (const doc of docs) {
    try {
      fs.unlinkSync(doc.filePath);
    } catch {
      // file already gone — fine, the row is gone either way
    }
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Draft-only direct edits (units, pricing, concessions, deposit terms)
// ---------------------------------------------------------------------------

const addUnitSchema = z.object({
  unitId: z.number(),
  effectiveStart: z.string(),
  effectiveEnd: z.string().optional(),
  contractedAreaSqm: decimalString,
  notes: z.string().optional(),
});

contractsRouter.post("/:id/units", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = addUnitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid unit payload." } });

  const unit = db.select().from(units).where(eq(units.id, parsed.data.unitId)).get();
  if (!unit) return res.status(404).json({ error: { code: "not_found", message: "Unit not found." } });
  if (req.user!.role !== "admin" && !req.user!.propertyIds.includes(unit.propertyId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to this unit's property." } });
  }

  const inserted = db.insert(contractUnits).values({ contractId, ...parsed.data }).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "contract_unit_added", entityType: "contract", entityId: contractId });
  res.status(201).json({ contractUnit: inserted });
});

const updateContractUnitSchema = z.object({
  effectiveStart: z.string().optional(),
  effectiveEnd: z.string().nullable().optional(),
  contractedAreaSqm: decimalString.optional(),
  notes: z.string().nullable().optional(),
});

contractsRouter.patch("/:id/units/:contractUnitId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contractUnitId = Number(req.params.contractUnitId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!contractUnitBelongsToContract(contractUnitId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Contract unit not found." } });
  }

  const parsed = updateContractUnitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid contract unit payload." } });

  const updated = db.update(contractUnits).set(parsed.data).where(eq(contractUnits.id, contractUnitId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "contract_unit_updated", entityType: "contract", entityId: contractId });
  res.json({ contractUnit: updated });
});

contractsRouter.delete("/:id/units/:contractUnitId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contractUnitId = Number(req.params.contractUnitId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!contractUnitBelongsToContract(contractUnitId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Contract unit not found." } });
  }

  db.transaction(() => {
    // A pricing stream can target this unit directly (pricing_stream_units);
    // removing the unit from the contract also removes it from whatever it
    // was individually targeted by — the stream itself is untouched and may
    // still target other units.
    db.delete(pricingStreamUnits).where(eq(pricingStreamUnits.contractUnitId, contractUnitId)).run();
    db.delete(contractUnits).where(eq(contractUnits.id, contractUnitId)).run();
  });
  recordAudit({ actorUserId: req.user!.id, action: "contract_unit_removed", entityType: "contract", entityId: contractId });
  res.status(204).send();
});

const addPricingStreamSchema = z.object({
  feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]),
  targetType: z.enum(["unit", "group", "contract"]),
  label: z.string().optional(),
  contractUnitIds: z.array(z.number()),
  initialRate: z.object({
    effectiveStart: z.string(),
    effectiveEnd: z.string().optional(),
    calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered"]),
    amountOrRate: decimalString,
    rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit"]),
    escalationBase: z.enum(["initial", "previous"]).optional(),
    escalationPercentage: decimalString.optional(),
    escalationIntervalMonths: z.number().optional(),
    unit: z.string().optional(),
  }),
});

contractsRouter.post("/:id/pricing-streams", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = addPricingStreamSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid pricing stream payload.", details: parsed.error.flatten() } });

  const { contractUnitIds, initialRate, ...streamFields } = parsed.data;
  const invalidUnitId = contractUnitIds.find((cuId) => !contractUnitBelongsToContract(cuId, contractId));
  if (invalidUnitId !== undefined) {
    return res.status(400).json({ error: { code: "invalid_reference", message: `Contract unit ${invalidUnitId} does not belong to this contract.` } });
  }

  const stream = db.insert(pricingStreams).values({ contractId, ...streamFields }).returning().get();
  for (const contractUnitId of contractUnitIds) {
    db.insert(pricingStreamUnits).values({ pricingStreamId: stream.id, contractUnitId }).run();
  }
  const rate = db
    .insert(rateSchedule)
    .values({ pricingStreamId: stream.id, ...initialRate })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "pricing_stream_added", entityType: "contract", entityId: contractId });
  res.status(201).json({ pricingStream: stream, rateSchedule: rate });
});

const updatePricingStreamSchema = z.object({
  feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]).optional(),
  targetType: z.enum(["unit", "group", "contract"]).optional(),
  label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  contractUnitIds: z.array(z.number()).optional(),
});

contractsRouter.patch("/:id/pricing-streams/:streamId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const streamId = Number(req.params.streamId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!pricingStreamBelongsToContract(streamId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Pricing stream not found." } });
  }

  const parsed = updatePricingStreamSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid pricing stream payload." } });

  const { contractUnitIds, ...streamFields } = parsed.data;
  if (contractUnitIds) {
    const invalidUnitId = contractUnitIds.find((cuId) => !contractUnitBelongsToContract(cuId, contractId));
    if (invalidUnitId !== undefined) {
      return res.status(400).json({ error: { code: "invalid_reference", message: `Contract unit ${invalidUnitId} does not belong to this contract.` } });
    }
  }

  const updated = db.transaction(() => {
    const stream = db.update(pricingStreams).set(streamFields).where(eq(pricingStreams.id, streamId)).returning().get();
    if (contractUnitIds) {
      db.delete(pricingStreamUnits).where(eq(pricingStreamUnits.pricingStreamId, streamId)).run();
      for (const contractUnitId of contractUnitIds) {
        db.insert(pricingStreamUnits).values({ pricingStreamId: streamId, contractUnitId }).run();
      }
    }
    return stream;
  });
  recordAudit({ actorUserId: req.user!.id, action: "pricing_stream_updated", entityType: "contract", entityId: contractId });
  res.json({ pricingStream: updated });
});

contractsRouter.delete("/:id/pricing-streams/:streamId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const streamId = Number(req.params.streamId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!pricingStreamBelongsToContract(streamId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Pricing stream not found." } });
  }

  // Never silently orphan a concession that specifically targets this stream,
  // or destroy usage/charge activity — ask the caller to reassign/remove it
  // first, the same way the whole-contract delete refuses on financial
  // activity rather than guessing what to do with it.
  const hasConcession = db.select().from(concessions).where(eq(concessions.pricingStreamId, streamId)).get();
  if (hasConcession) {
    return res.status(409).json({ error: { code: "has_dependents", message: "A concession targets this pricing stream — remove or reassign it first." } });
  }
  const hasUsage = db.select().from(usageEntries).where(eq(usageEntries.pricingStreamId, streamId)).get();
  const hasCharges = db.select().from(charges).where(eq(charges.pricingStreamId, streamId)).get();
  if (hasUsage || hasCharges) {
    return res.status(409).json({ error: { code: "has_dependents", message: "This pricing stream has usage entries or charges recorded against it." } });
  }

  db.transaction(() => {
    db.delete(rateSchedule).where(eq(rateSchedule.pricingStreamId, streamId)).run();
    db.delete(pricingStreamUnits).where(eq(pricingStreamUnits.pricingStreamId, streamId)).run();
    db.delete(pricingStreams).where(eq(pricingStreams.id, streamId)).run();
  });
  recordAudit({ actorUserId: req.user!.id, action: "pricing_stream_removed", entityType: "contract", entityId: contractId });
  res.status(204).send();
});

const rateScheduleTierSchema = z.object({
  effectiveStart: z.string(),
  effectiveEnd: z.string().optional(),
  calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation", "metered"]),
  amountOrRate: decimalString,
  rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit"]),
  escalationBase: z.enum(["initial", "previous"]).optional(),
  escalationPercentage: decimalString.optional(),
  escalationIntervalMonths: z.number().optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

contractsRouter.post("/:id/pricing-streams/:streamId/rate-schedule", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const streamId = Number(req.params.streamId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!pricingStreamBelongsToContract(streamId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Pricing stream not found." } });
  }

  const parsed = rateScheduleTierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid rate schedule payload." } });

  const inserted = db.insert(rateSchedule).values({ pricingStreamId: streamId, ...parsed.data }).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "rate_schedule_tier_added", entityType: "contract", entityId: contractId });
  res.status(201).json({ rateSchedule: inserted });
});

contractsRouter.patch("/:id/pricing-streams/:streamId/rate-schedule/:rateId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const streamId = Number(req.params.streamId);
  const rateId = Number(req.params.rateId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!pricingStreamBelongsToContract(streamId, contractId) || !rateScheduleBelongsToStream(rateId, streamId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Rate schedule entry not found." } });
  }

  // .partial() alone isn't enough for the nullable columns: an edit form
  // re-submits a previously-null value as null, not as "the field was
  // omitted", so those must accept null explicitly.
  const updateRateScheduleTierSchema = rateScheduleTierSchema.partial().extend({
    effectiveEnd: z.string().nullable().optional(),
    escalationBase: z.enum(["initial", "previous"]).nullable().optional(),
    escalationPercentage: decimalString.nullable().optional(),
    escalationIntervalMonths: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  });
  const parsed = updateRateScheduleTierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid rate schedule payload." } });

  const updated = db.update(rateSchedule).set(parsed.data).where(eq(rateSchedule.id, rateId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "rate_schedule_tier_updated", entityType: "contract", entityId: contractId });
  res.json({ rateSchedule: updated });
});

contractsRouter.delete("/:id/pricing-streams/:streamId/rate-schedule/:rateId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const streamId = Number(req.params.streamId);
  const rateId = Number(req.params.rateId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!pricingStreamBelongsToContract(streamId, contractId) || !rateScheduleBelongsToStream(rateId, streamId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Rate schedule entry not found." } });
  }

  db.delete(rateSchedule).where(eq(rateSchedule.id, rateId)).run();
  recordAudit({ actorUserId: req.user!.id, action: "rate_schedule_tier_removed", entityType: "contract", entityId: contractId });
  res.status(204).send();
});

const addConcessionSchema = z.object({
  pricingStreamId: z.number().nullable(),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  discountPercentage: decimalString,
  reason: z.string().optional(),
});

contractsRouter.post("/:id/concessions", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = addConcessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid concession payload." } });
  if (parsed.data.pricingStreamId !== null && !pricingStreamBelongsToContract(parsed.data.pricingStreamId, contractId)) {
    return res.status(400).json({ error: { code: "invalid_reference", message: "Pricing stream does not belong to this contract." } });
  }

  const inserted = db.insert(concessions).values({ contractId, ...parsed.data }).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "concession_added", entityType: "contract", entityId: contractId });
  res.status(201).json({ concession: inserted });
});

function concessionBelongsToContract(concessionId: number, contractId: number): boolean {
  const concession = db.select().from(concessions).where(eq(concessions.id, concessionId)).get();
  return concession?.contractId === contractId;
}

// .partial() alone isn't enough for reason: an edit form re-submits a
// previously-null value as null, not as "the field was omitted", so it must
// accept null explicitly rather than only "string or absent".
const updateConcessionSchema = addConcessionSchema.partial().extend({ reason: z.string().nullable().optional() });

contractsRouter.patch("/:id/concessions/:concessionId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const concessionId = Number(req.params.concessionId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!concessionBelongsToContract(concessionId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Concession not found." } });
  }

  const parsed = updateConcessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid concession payload." } });
  if (parsed.data.pricingStreamId != null && !pricingStreamBelongsToContract(parsed.data.pricingStreamId, contractId)) {
    return res.status(400).json({ error: { code: "invalid_reference", message: "Pricing stream does not belong to this contract." } });
  }

  const updated = db.update(concessions).set(parsed.data).where(eq(concessions.id, concessionId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "concession_updated", entityType: "contract", entityId: contractId });
  res.json({ concession: updated });
});

contractsRouter.delete("/:id/concessions/:concessionId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const concessionId = Number(req.params.concessionId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!concessionBelongsToContract(concessionId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Concession not found." } });
  }

  db.delete(concessions).where(eq(concessions.id, concessionId)).run();
  recordAudit({ actorUserId: req.user!.id, action: "concession_removed", entityType: "contract", entityId: contractId });
  res.status(204).send();
});

const depositTermsSchema = z.object({
  effectiveStart: z.string(),
  requirementType: z.enum(["fixed", "formula"]),
  fixedAmountFen: z.number().optional(),
  formulaBasis: z.string().optional(),
  waiverConditionText: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

contractsRouter.post("/:id/deposit-terms", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = depositTermsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit terms payload." } });

  const inserted = db.insert(depositTerms).values({ contractId, ...parsed.data }).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "deposit_terms_set", entityType: "contract", entityId: contractId });
  res.status(201).json({ depositTerms: inserted });
});

function depositTermsBelongToContract(depositTermId: number, contractId: number): boolean {
  const dt = db.select().from(depositTerms).where(eq(depositTerms.id, depositTermId)).get();
  return dt?.contractId === contractId;
}

// General edit of the descriptive/amount fields, distinct from the
// admin-only waiver-decision route below (waiverMet / waiverEvidenceDocumentId
// stay reserved for that explicit, evidenced decision). Nullable, not just
// optional, on every field but the two that are always required: an edit
// form re-submits a previously-null value as null, not as "the field was
// omitted".
const updateDepositTermsSchema = z.object({
  effectiveStart: z.string().optional(),
  requirementType: z.enum(["fixed", "formula"]).optional(),
  fixedAmountFen: z.number().nullable().optional(),
  formulaBasis: z.string().nullable().optional(),
  waiverConditionText: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

contractsRouter.patch("/:id/deposit-terms/:depositTermId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const depositTermId = Number(req.params.depositTermId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!depositTermsBelongToContract(depositTermId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Deposit terms not found." } });
  }

  const parsed = updateDepositTermsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit terms payload." } });

  const updated = db.update(depositTerms).set(parsed.data).where(eq(depositTerms.id, depositTermId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "deposit_terms_updated", entityType: "contract", entityId: contractId });
  res.json({ depositTerms: updated });
});

contractsRouter.delete("/:id/deposit-terms/:depositTermId", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const depositTermId = Number(req.params.depositTermId);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;
  if (!depositTermsBelongToContract(depositTermId, contractId)) {
    return res.status(404).json({ error: { code: "not_found", message: "Deposit terms not found." } });
  }

  db.delete(depositTerms).where(eq(depositTerms.id, depositTermId)).run();
  recordAudit({ actorUserId: req.user!.id, action: "deposit_terms_removed", entityType: "contract", entityId: contractId });
  res.status(204).send();
});

/** Admin-only: a waiver condition that can't be determined from structured
 * data is recorded explicitly, with reason/evidence, per brief §6. */
const waiverDecisionSchema = z.object({
  waiverMet: z.boolean(),
  waiverEvidenceDocumentId: z.number().optional(),
  notes: z.string().optional(),
});

contractsRouter.patch("/deposit-terms/:depositTermId/waiver-decision", requireRole("admin"), (req, res) => {
  const id = Number(req.params.depositTermId);
  const parsed = waiverDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid payload." } });

  const existing = db.select().from(depositTerms).where(eq(depositTerms.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "Deposit terms not found." } });

  const updated = db.update(depositTerms).set(parsed.data).where(eq(depositTerms.id, id)).returning().get();
  recordAudit({
    actorUserId: req.user!.id,
    action: "deposit_waiver_decided",
    entityType: "deposit_terms",
    entityId: id,
    reason: parsed.data.notes,
  });
  res.json({ depositTerms: updated });
});

const billingRulesSchema = z.object({
  billingFrequency: z.enum(["monthly", "quarterly", "yearly"]).optional(),
  periodAnchorDay: z.number().optional(),
  dueDay: z.number().optional(),
  dueMonthOffset: z.number().optional(),
});

contractsRouter.patch("/:id/billing-rules", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = billingRulesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid billing rules payload." } });

  const updated = db.update(billingRules).set(parsed.data).where(eq(billingRules.contractId, contractId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "billing_rules_updated", entityType: "contract", entityId: contractId });
  res.json({ billingRules: updated });
});

const latePenaltySchema = z.object({
  latePenaltyEnabled: z.boolean(),
  latePenaltyDailyRatePermille: decimalString.optional(),
  latePenaltyCapFen: z.number().optional(),
});

contractsRouter.patch("/:id/late-penalty-rules", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (!requireDraft(contract, res)) return;

  const parsed = latePenaltySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid late penalty payload." } });

  const updated = db.update(billingRules).set(parsed.data).where(eq(billingRules.contractId, contractId)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "late_penalty_rules_updated", entityType: "contract", entityId: contractId });
  res.json({ billingRules: updated });
});

// ---------------------------------------------------------------------------
// Activation (locks direct edits; further changes must go through amendments)
// ---------------------------------------------------------------------------

contractsRouter.post("/:id/activate", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const contract = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!contract) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  if (contract.status !== "draft") {
    return res.status(409).json({ error: { code: "not_draft", message: "Only a draft contract can be activated." } });
  }

  const signedLease = db
    .select()
    .from(documentsTable)
    .all()
    .find((d) => d.ownerType === "contract" && d.ownerId === id && d.docType === "signed_lease");
  if (!signedLease) {
    return res.status(409).json({ error: { code: "missing_signed_lease", message: "A signed main lease document is required before activation." } });
  }

  const updated = db.update(contracts).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(contracts.id, id)).returning().get();
  recordContractVersion(id, updated.versionNumber, updated.termStart, null);
  recordAudit({ actorUserId: req.user!.id, action: "contract_activated", entityType: "contract", entityId: id });
  res.json({ contract: updated });
});

// ---------------------------------------------------------------------------
// Charge generation
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
});

contractsRouter.post("/:id/generate-charges", requireRole("admin", "manager"), (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid period." } });

  const [year, month] = parsed.data.period.split("-").map(Number);
  const periodStart = `${parsed.data.period}-01`;
  const periodEnd = `${parsed.data.period}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  try {
    const result = generateChargesForContractMonth(contractId, periodStart, periodEnd);
    recordAudit({
      actorUserId: req.user!.id,
      action: "charges_generated",
      entityType: "contract",
      entityId: contractId,
      details: { period: parsed.data.period, ...result },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: { code: "generation_failed", message: String(err) } });
  }
});

contractsRouter.get("/:id/charges", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const rows = db.select().from(charges).where(eq(charges.contractId, contractId)).all();
  res.json({ charges: rows });
});

contractsRouter.get("/:id/statement", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) {
    return res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
  }
  const period = req.query.period as string | undefined;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Provide ?period=YYYY-MM." } });
  }
  const [year, month] = period.split("-").map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = `${period}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const input = loadLedgerInputs(contractId);
  const statement = computeMonthlyStatement(input, periodStart, periodEnd);
  res.json({ statement });
});

contractsRouter.get("/:id/escalation-preview/:rateScheduleId", (req, res) => {
  const rateId = Number(req.params.rateScheduleId);
  const rate = db.select().from(rateSchedule).where(eq(rateSchedule.id, rateId)).get();
  if (!rate) return res.status(404).json({ error: { code: "not_found", message: "Rate schedule not found." } });
  const tiers = previewEscalationTiers(
    {
      id: rate.id,
      pricingStreamId: rate.pricingStreamId,
      effectiveStart: rate.effectiveStart,
      effectiveEnd: rate.effectiveEnd,
      calculationMethod: rate.calculationMethod,
      amountOrRate: rate.amountOrRate,
      rateBasis: rate.rateBasis,
      escalationBase: rate.escalationBase,
      escalationPercentage: rate.escalationPercentage,
      escalationIntervalMonths: rate.escalationIntervalMonths,
      unit: rate.unit,
    },
    10,
  );
  res.json({ tiers });
});
