import { Router } from "express";
import { z } from "zod";
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
  units,
  documents as documentsTable,
} from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getContractPropertyIds, canAccessContract } from "../lib/contractScope.js";
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
  res.json({ contracts: visible });
});

const createContractSchema = z.object({
  referenceNumber: z.string().min(1),
  landlordPartyId: z.number(),
  tenantPartyId: z.number(),
  termStart: z.string(),
  termEnd: z.string(),
  renewalNoticeDays: z.number().optional(),
  specialTerms: z.string().optional(),
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

const addPricingStreamSchema = z.object({
  feeType: z.enum(["rent", "management", "electricity_base", "water", "elevator", "other"]),
  targetType: z.enum(["unit", "group", "contract"]),
  label: z.string().optional(),
  contractUnitIds: z.array(z.number()),
  initialRate: z.object({
    effectiveStart: z.string(),
    effectiveEnd: z.string().optional(),
    calculationMethod: z.enum(["flat", "per_sqm", "percentage_escalation"]),
    amountOrRate: decimalString,
    rateBasis: z.enum(["per_month", "per_quarter", "per_year", "per_sqm_per_month"]),
    escalationBase: z.enum(["initial", "previous"]).optional(),
    escalationPercentage: decimalString.optional(),
    escalationIntervalMonths: z.number().optional(),
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

  const inserted = db.insert(concessions).values({ contractId, ...parsed.data }).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "concession_added", entityType: "contract", entityId: contractId });
  res.status(201).json({ concession: inserted });
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
    },
    10,
  );
  res.json({ tiers });
});
