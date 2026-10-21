import { Router } from "express";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { billingRules, charges, contractUnits, contracts, openingBalances, parties, properties, receipts, units } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { contractOutstanding } from "../lib/archiveGuards.js";
import { openingStanding, OPENING_METHOD, planOpening } from "../lib/openingBalance.js";
import { recordAudit } from "../lib/audit.js";
import { contractRef } from "../lib/auditDetail.js";
import { isoDate } from "../lib/validate.js";
import { loadChargeContext } from "../billing/generate.js";
import { applyPlan, billingEligibility, currentCutoff, planBilling } from "../billing/autoBilling.js";
import type { OpenCharge } from "../billing/allocation.js";
import { OpeningError, billsInScope, hasOtherPayments, liveRecord, performOpening, planExtras } from "./openingBalance.js";
import { EXTRA_FEE_TYPES, meteredStartFor, type OpeningExtra } from "../lib/openingBalance.js";
import { todayInChina } from "@lcm/shared";

/** The Go-live checklist: every contract that already exists, with where it stands on being brought
 * up to date — read-only; the work itself is done on each contract's Charges tab. */
export const goLiveRouter = Router();
goLiveRouter.use(requireAuth, requireRole("admin"));

goLiveRouter.get("/contracts", (_req, res) => {
  const all = db.select().from(contracts).where(and(ne(contracts.status, "draft"), eq(contracts.archived, false))).all();
  const partyName = new Map(db.select({ id: parties.id, name: parties.name }).from(parties).all().map((p) => [p.id, p.name]));
  const unitRows = db.select().from(units).all();
  const propertyName = new Map(db.select({ id: properties.id, name: properties.name }).from(properties).all().map((p) => [p.id, p.name]));
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  const cuByContract = new Map<number, number[]>();
  for (const cu of db.select().from(contractUnits).all()) cuByContract.set(cu.contractId, [...(cuByContract.get(cu.contractId) ?? []), cu.unitId]);
  const rules = new Map(db.select({ id: billingRules.contractId, auto: billingRules.autoBilling }).from(billingRules).all().map((r) => [r.id, r.auto]));
  const chargeCount = new Map<number, number>();
  for (const c of db.select({ contractId: charges.contractId, status: charges.status }).from(charges).all()) {
    if (c.status === "posted") chargeCount.set(c.contractId, (chargeCount.get(c.contractId) ?? 0) + 1);
  }
  const allReceipts = db.select().from(receipts).all();
  const live = new Map(db.select().from(openingBalances).where(ne(openingBalances.status, "reversed")).all().map((o) => [o.contractId, o]));

  const rows = all
    .sort((a, b) => a.referenceNumber.localeCompare(b.referenceNumber))
    .map((c) => {
      const place = Array.from(
        new Set(
          (cuByContract.get(c.id) ?? []).map((uid) => {
            const u = unitById.get(uid);
            return u ? `${propertyName.get(u.propertyId) ?? ""} ${u.unitLabel}`.trim() : "";
          }),
        ),
      )
        .filter(Boolean)
        .join(", ");
      const { unpaidFen, depositHeldFen } = contractOutstanding(c.id);
      const o = live.get(c.id);
      const otherPayments = allReceipts.some((r) => r.contractId === c.id && r.status === "posted" && r.paymentMethod !== OPENING_METHOD);
      const later = o ? allReceipts.some((r) => r.contractId === c.id && r.paymentMethod !== OPENING_METHOD && r.createdAt > o.createdAt) : false;
      const standing = o ? openingStanding(o, later) : null;
      const receipt = o?.receiptId ? allReceipts.find((r) => r.id === o.receiptId) : null;
      return {
        id: c.id,
        referenceNumber: c.referenceNumber,
        status: c.status,
        tenantName: partyName.get(c.tenantPartyId) ?? "",
        landlordName: partyName.get(c.landlordPartyId) ?? "",
        place,
        termStart: c.termStart,
        termEnd: c.termEnd,
        autoBilling: rules.get(c.id) ?? false,
        chargeCount: chargeCount.get(c.id) ?? 0,
        unpaidFen,
        depositHeldFen,
        hasOtherPayments: otherPayments,
        opening: o && standing ? { asOfDate: o.asOfDate, balanceOwedFen: o.balanceOwedFen, paymentFen: receipt?.amountFen ?? 0, status: standing.status, provisionalUntil: o.provisionalUntil } : null,
      };
    });
  res.json({ contracts: rows });
});

// ---------------------------------------------------------------------------
// Batch: apply the accountant's balances to many contracts at once
// ---------------------------------------------------------------------------

type SkipReason = "extra_no_item" | "extra_not_metered" | "unknown_contract" | "invalid_balance" | "not_active" | "already_done" | "has_payments" | "not_eligible" | "future_date" | "before_term";

const planItems = z.object({
  asOfDate: isoDate,
  items: z
    .array(
      z.object({
        reference: z.string().trim().min(1).max(100),
        balanceOwedFen: z.number().int().nullable(),
        electricityFen: z.number().int().min(0).nullable().optional(),
        waterFen: z.number().int().min(0).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const extrasOf = (it: { electricityFen?: number | null; waterFen?: number | null }): OpeningExtra[] =>
  [
    { feeType: "electricity_base" as const, amountFen: it.electricityFen ?? 0 },
    { feeType: "water" as const, amountFen: it.waterFen ?? 0 },
  ].filter((e) => e.amountFen > 0);

/** Bills still to be created (catch-up) and the opening payment that would follow, nothing written.
 * The catch-up bills due by the as-of date count as billed, so the plan can be made before they exist. */
function predictOne(contractId: number, balanceOwedFen: number, asOfDate: string) {
  const ctx = loadChargeContext(contractId);
  let catchUp: { count: number; totalFen: number } | null = null;
  let planned: OpenCharge[] = [];
  let missingReadings = 0;
  if (!ctx.rules.autoBilling) {
    if (!billingEligibility(ctx).ok) return "not_eligible" as const;
    const plan = planBilling(ctx, currentCutoff());
    catchUp = { count: plan.charges.length, totalFen: plan.totalFen };
    // Months before the as-of month are settled outside the system, so their readings aren't missing.
    missingReadings = plan.missingReadings.filter((m) => m.periodStart >= meteredStartFor(asOfDate)).length;
    planned = plan.charges
      .filter((c) => c.dueDate <= asOfDate)
      .map((c, i) => ({ chargeId: -(i + 1), dueDate: c.dueDate, serviceStart: c.serviceStart, balanceFen: c.amountFen }));
  }
  const existing = billsInScope(contractId, asOfDate, null).open;
  return { opening: planOpening([...existing, ...planned], balanceOwedFen), catchUp, missingReadings };
}

/** What would happen for one contract: bills still to be created (catch-up), then the opening payment with
 * the newest bills left unpaid. Read-only. */
function planOne(reference: string, balanceOwedFen: number | null, asOfDate: string, extras: OpeningExtra[]) {
  const contract = db.select().from(contracts).where(eq(contracts.referenceNumber, reference)).get();
  const skip = (reason: SkipReason, extra: Record<string, unknown> = {}) => ({ reference, contractId: contract?.id ?? null, tenantName: null as string | null, state: "skipped" as const, reason, ...extra });
  if (!contract) return skip("unknown_contract");
  const tenantName = db.select({ n: parties.name }).from(parties).where(eq(parties.id, contract.tenantPartyId)).get()?.n ?? null;
  const skipC = (reason: SkipReason, extra: Record<string, unknown> = {}) => ({ ...skip(reason, extra), tenantName });
  if (balanceOwedFen === null || balanceOwedFen < 0) return skipC("invalid_balance");
  if (contract.status !== "active") return skipC("not_active");
  if (asOfDate > todayInChina()) return skipC("future_date");
  if (asOfDate < contract.termStart) return skipC("before_term");
  if (liveRecord(contract.id)) return skipC("already_done");
  if (hasOtherPayments(contract.id, null)) return skipC("has_payments");

  const pred = predictOne(contract.id, balanceOwedFen, asOfDate);
  if (pred === "not_eligible") return skipC("not_eligible");
  const { opening, catchUp, missingReadings } = pred;
  const extraPlan = planExtras(contract.id, extras);
  if (extraPlan.problems.length > 0) return skipC(extraPlan.problems[0].code as SkipReason, { extras: extraPlan.rows });
  if (opening.problems.length > 0) {
    return skipC(opening.problems[0] as unknown as SkipReason, { billedFen: opening.billedFen, balanceOwedFen });
  }
  return {
    reference,
    contractId: contract.id,
    tenantName,
    state: "ready" as const,
    reason: null,
    balanceOwedFen,
    billedFen: opening.billedFen,
    paymentFen: opening.paymentFen,
    billCount: opening.rows.length,
    unpaidBills: opening.rows.filter((r) => r.unpaidFen > 0).length,
    // Bills left part-paid: the balance doesn't fall on a bill boundary, so check these by hand.
    partialBills: opening.rows.filter((r) => r.unpaidFen > 0 && r.unpaidFen < r.balanceFen).length,
    catchUp,
    missingReadings,
    extras: extraPlan.rows,
  };
}

goLiveRouter.post("/plan", (req, res) => {
  const parsed = planItems.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Check the as-of date and the balances." } });
  const seen = new Set<string>();
  const results = parsed.data.items.map((it) => {
    if (seen.has(it.reference)) return { reference: it.reference, contractId: null, tenantName: null, state: "skipped" as const, reason: "duplicate_row" };
    seen.add(it.reference);
    return planOne(it.reference, it.balanceOwedFen, parsed.data.asOfDate, extrasOf(it));
  });
  res.json({ results });
});

const applyItems = z.object({
  asOfDate: isoDate,
  items: z
    .array(
      z.object({
        contractId: z.number().int(),
        balanceOwedFen: z.number().int().min(0),
        expectedBilledFen: z.number().int(),
        expectedBillCount: z.number().int(),
        extras: z.array(z.object({ feeType: z.enum(EXTRA_FEE_TYPES), amountFen: z.number().int().min(0) })).optional(),
        catchUp: z.object({ count: z.number().int(), totalFen: z.number().int() }).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

// Each contract is applied on its own: one that can't be done is reported and the rest carry on.
goLiveRouter.post("/apply", (req, res) => {
  const parsed = applyItems.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Check the as-of date and the balances." } });
  const userId = req.user!.id;
  const results: { contractId: number; ok: boolean; error?: { code: string; message: string }; billsCreated?: number; paymentFen?: number }[] = [];
  for (const it of parsed.data.items) {
    try {
      let billsCreated = 0;
      // Check what was previewed still holds before anything is posted, so a mismatch leaves the contract untouched.
      const pred = predictOne(it.contractId, it.balanceOwedFen, parsed.data.asOfDate);
      if (pred === "not_eligible") throw new OpeningError(409, "not_eligible", "Only an active, monthly-billed contract can be caught up automatically.");
      const sameCatchUp = (pred.catchUp?.count ?? -1) === (it.catchUp?.count ?? -1) && (pred.catchUp?.totalFen ?? -1) === (it.catchUp?.totalFen ?? -1);
      if (!sameCatchUp || pred.opening.billedFen !== it.expectedBilledFen || pred.opening.rows.length !== it.expectedBillCount) {
        throw new OpeningError(409, "stale_preview", "The bills changed since you previewed this. Preview again to see the current figures.");
      }
      if (pred.opening.problems.length > 0) throw new OpeningError(400, pred.opening.problems[0], "This balance can't be applied. Preview again.");
      if (it.catchUp) {
        const ctx = loadChargeContext(it.contractId);
        if (!billingEligibility(ctx).ok) throw new OpeningError(409, "not_eligible", "Only an active, monthly-billed contract can be caught up automatically.");
        const plan = planBilling(ctx, currentCutoff());
        if (plan.totalFen !== it.catchUp.totalFen || plan.charges.length !== it.catchUp.count) {
          throw new OpeningError(409, "plan_changed", "The contract's terms or readings changed since the preview. Preview again.");
        }
        billsCreated = applyPlan(ctx, plan, true);
        recordAudit({ actorUserId: userId, action: "billing_catch_up", entityType: "contract", entityId: it.contractId, details: { contract: contractRef(it.contractId), created: billsCreated, totalFen: plan.totalFen, cutoff: plan.cutoff, missingReadings: plan.missingReadings.length } });
      }
      const r = performOpening(userId, it.contractId, { asOfDate: parsed.data.asOfDate, balanceOwedFen: it.balanceOwedFen, extras: it.extras, expectedBilledFen: it.expectedBilledFen, expectedBillCount: it.expectedBillCount }, false);
      results.push({ contractId: it.contractId, ok: true, billsCreated, paymentFen: r.paymentFen });
    } catch (err) {
      if (err instanceof OpeningError) results.push({ contractId: it.contractId, ok: false, error: { code: err.code, message: err.message } });
      else {
        // One contract's unexpected failure must not stop the rest of the batch.
        console.error(`Go-live apply failed for contract ${it.contractId}`, err);
        results.push({ contractId: it.contractId, ok: false, error: { code: "internal_error", message: "Unexpected server error." } });
      }
    }
  }
  recordAudit({
    actorUserId: userId,
    action: "go_live_batch_applied",
    entityType: "opening_balance",
    details: { asOfDate: parsed.data.asOfDate, count: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, totalFen: results.reduce((s, r) => s + (r.paymentFen ?? 0), 0) },
  });
  res.json({ results });
});

// Close the adjustment period on every provisional opening balance at once (after reviewing them).
goLiveRouter.post("/finalize", (req, res) => {
  const parsed = z.object({ contractIds: z.array(z.number().int()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Choose the contracts to finalize." } });
  const now = new Date().toISOString();
  let finalized = 0;
  for (const contractId of parsed.data.contractIds) {
    const row = liveRecord(contractId);
    if (!row || row.status !== "provisional") continue;
    db.update(openingBalances).set({ status: "final", finalizedAt: now }).where(eq(openingBalances.id, row.id)).run();
    recordAudit({ actorUserId: req.user!.id, action: "opening_balance_finalized", entityType: "opening_balance", entityId: row.id, details: { contract: contractRef(contractId), asOfDate: row.asOfDate, balanceOwedFen: row.balanceOwedFen } });
    finalized += 1;
  }
  res.json({ finalized });
});
