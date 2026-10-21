import { Router } from "express";
import { z } from "zod";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { billingRules, charges, contracts, openingBalances, pricingStreams, rateSchedule, receipts, receiptAllocations } from "../db/schema.js";
import { fenAmount, isoDate } from "../lib/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { contractRef } from "../lib/auditDetail.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance } from "../billing/ledger.js";
import type { OpenCharge } from "../billing/allocation.js";
import {
  EXTRA_FEE_TYPES,
  OPENING_METHOD,
  broughtForwardId,
  broughtForwardSnapshot,
  meteredStartFor,
  openingStanding,
  planOpening,
  provisionalUntil,
  type OpeningExtra,
  type OpeningPlan,
} from "../lib/openingBalance.js";
import { PaymentError, applyAllocations } from "./payments.js";
import { todayInChina } from "@lcm/shared";

/** Go-live for a contract that already existed: the accountant's balance as of a date becomes
 * one "Opening balance" receipt that pays every bill due by then except what is still owed. */
export const openingBalanceRouter = Router();
openingBalanceRouter.use(requireAuth, requireRole("admin"));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PROBLEM_MESSAGES: Record<string, string> = {
  extra_no_item: "This contract has no electricity or water item to bring that balance forward on.",
  extra_not_metered: "That item isn't metered on this contract, so the system bills it normally — include it in the rent and fixed fees balance instead.",
  negative_balance: "The balance owed can't be negative.",
  balance_exceeds_billed: "The balance owed is more than everything billed up to that date. Check the as-of date and that the bills have been generated (Catch up billing).",
  unpaid_unknown_bill: "One of the bills you chose isn't part of this opening balance.",
  unpaid_exceeds_bill: "An unpaid amount is more than that bill's balance.",
  unpaid_total_mismatch: "The unpaid amounts must add up exactly to the balance owed.",
};

function guard(req: import("express").Request, res: import("express").Response, contractId: number): boolean {
  if (!canAccessContract(req.user!, contractId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return false;
  }
  return !rejectIfDraft(res, contractId);
}

export const liveRecord = (contractId: number) =>
  db.select().from(openingBalances).where(and(eq(openingBalances.contractId, contractId), ne(openingBalances.status, "reversed"))).get();

/** Receipts recorded on the contract after this opening balance was applied (other than its own). */
function laterPayment(contractId: number, since: string): boolean {
  return !!db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.contractId, contractId), ne(receipts.paymentMethod, OPENING_METHOD), gt(receipts.createdAt, since)))
    .get();
}

function standingOf(row: typeof openingBalances.$inferSelect) {
  return openingStanding(row, laterPayment(row.contractId, row.createdAt));
}

/** Other receipts that would make an opening balance unsafe: any real payment already on the contract. */
export function hasOtherPayments(contractId: number, ownReceiptId: number | null): boolean {
  return db
    .select({ id: receipts.id, status: receipts.status })
    .from(receipts)
    .where(eq(receipts.contractId, contractId))
    .all()
    .some((r) => r.status === "posted" && r.id !== ownReceiptId);
}

/** Bills due on or before the date with what each owes. `ignoreReceiptId` treats that receipt as not yet applied. */
export function billsInScope(contractId: number, asOf: string, ignoreReceiptId: number | null) {
  const data = loadLedgerInputs(contractId);
  const allocations = ignoreReceiptId === null ? data.allocations : data.allocations.filter((a) => a.receiptId !== ignoreReceiptId);
  const open: OpenCharge[] = [];
  const labels = new Map(db.select({ id: pricingStreams.id, label: pricingStreams.label }).from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all().map((s) => [s.id, s.label]));
  const info = new Map<number, { feeType: string; streamLabel: string; serviceStart: string; serviceEnd: string; dueDate: string; balanceFen: number }>();
  for (const c of data.charges) {
    if (c.status !== "posted" || c.dueDate > asOf) continue;
    // A brought-forward utility bill is never settled by the opening payment.
    if (broughtForwardId(data.chargesRaw.find((x) => x.id === c.id)!.calculationSnapshotJson) !== null) continue;
    const b = computeChargeBalance(c, data.adjustments, allocations, asOf, data.overdueGraceDays);
    if (b.balanceFen <= 0) continue;
    const raw = data.chargesRaw.find((x) => x.id === c.id)!;
    open.push({ chargeId: c.id, dueDate: c.dueDate, serviceStart: c.serviceStart, balanceFen: b.balanceFen });
    info.set(c.id, { feeType: raw.feeType, streamLabel: labels.get(raw.pricingStreamId) ?? raw.feeType, serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, dueDate: c.dueDate, balanceFen: b.balanceFen });
  }
  return { open, info };
}

const extrasSchema = z.array(z.object({ feeType: z.enum(EXTRA_FEE_TYPES), amountFen: fenAmount })).max(EXTRA_FEE_TYPES.length);

const inputSchema = z.object({
  asOfDate: isoDate,
  balanceOwedFen: fenAmount,
  unpaid: z.array(z.object({ chargeId: z.number().int(), unpaidFen: z.number().int().min(0) })).optional(),
  extras: extrasSchema.optional(),
});

/** The brought-forward utility bills an accountant's balances would create, with the item each lands on. */
export function planExtras(contractId: number, extras: OpeningExtra[] | undefined) {
  const rows: { feeType: OpeningExtra["feeType"]; amountFen: number; pricingStreamId: number; streamLabel: string }[] = [];
  const problems: { code: string; feeType: string }[] = [];
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  for (const e of extras ?? []) {
    if (e.amountFen <= 0) continue;
    const ofType = streams.filter((s) => s.feeType === e.feeType);
    if (ofType.length === 0) {
      problems.push({ code: "extra_no_item", feeType: e.feeType });
      continue;
    }
    const metered = ofType.find((s) => db.select().from(rateSchedule).where(eq(rateSchedule.pricingStreamId, s.id)).all().some((r) => r.calculationMethod === "metered"));
    if (!metered) {
      problems.push({ code: "extra_not_metered", feeType: e.feeType });
      continue;
    }
    rows.push({ feeType: e.feeType, amountFen: e.amountFen, pricingStreamId: metered.id, streamLabel: metered.label ?? e.feeType });
  }
  return { rows, problems };
}

/** Voids the brought-forward bills of an opening balance (when it is adjusted or undone). Bills that already
 * have money applied are left alone. */
function voidBroughtForward(tx: Tx, openingBalanceId: number, userId: number, reason: string) {
  const mine = tx.select().from(charges).all().filter((c) => c.status === "posted" && broughtForwardId(c.calculationSnapshotJson) === openingBalanceId);
  for (const c of mine) {
    const applied = tx.select().from(receiptAllocations).where(eq(receiptAllocations.chargeId, c.id)).all().reduce((s, a) => s + a.amountFen, 0);
    if (applied !== 0) continue;
    tx.update(charges).set({ status: "voided", voidedAt: new Date().toISOString(), voidedBy: userId, voidReason: reason }).where(eq(charges.id, c.id)).run();
  }
}

/** Puts back the metered start date this opening balance set, if nothing has changed it since. */
function restoreMeteredFrom(tx: Tx, row: typeof openingBalances.$inferSelect) {
  if (!row.meteredFromSet) return;
  tx.update(billingRules).set({ meteredBillingFrom: null }).where(and(eq(billingRules.contractId, row.contractId), eq(billingRules.meteredBillingFrom, row.meteredFromSet))).run();
}

function checkDate(contractId: number, asOfDate: string): string | null {
  if (asOfDate > todayInChina()) return "The as-of date can't be in the future.";
  const c = db.select({ termStart: contracts.termStart }).from(contracts).where(eq(contracts.id, contractId)).get();
  if (c && asOfDate < c.termStart) return "The as-of date is before the contract starts.";
  return null;
}

function describePlan(plan: OpeningPlan, info: ReturnType<typeof billsInScope>["info"], extras: ReturnType<typeof planExtras>) {
  return {
    extras: extras.rows,
    extraProblems: extras.problems.map((p) => ({ ...p, message: PROBLEM_MESSAGES[p.code] })),
    billedFen: plan.billedFen,
    balanceOwedFen: plan.balanceOwedFen,
    paymentFen: plan.paymentFen,
    billCount: plan.rows.length,
    problems: plan.problems.map((code) => ({ code, message: PROBLEM_MESSAGES[code] })),
    rows: plan.rows.map((r) => ({ ...r, ...info.get(r.chargeId)! })),
  };
}

// Where this contract stands: nothing yet, or an opening balance and whether it can still be adjusted.
openingBalanceRouter.get("/contracts/:id/opening-balance", (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const row = liveRecord(contractId);
  if (!row) {
    return res.json({ record: null, blocked: hasOtherPayments(contractId, null) ? "has_payments" : null });
  }
  const standing = standingOf(row);
  const receipt = row.receiptId ? db.select().from(receipts).where(eq(receipts.id, row.receiptId)).get() : null;
  res.json({
    record: { ...row, ...standing, paymentFen: receipt?.amountFen ?? 0, receiptId: row.receiptId, extras: row.extrasJson ? (JSON.parse(row.extrasJson) as OpeningExtra[]) : [] },
    blocked: null,
  });
});

// Preview: which bills fall in scope and how the opening payment would settle them.
openingBalanceRouter.post("/contracts/:id/opening-balance/preview", (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Enter the as-of date and the balance owed." } });
  const dateErr = checkDate(contractId, parsed.data.asOfDate);
  if (dateErr) return res.status(400).json({ error: { code: "invalid_input", message: dateErr } });

  const live = liveRecord(contractId);
  const standing = live ? standingOf(live) : null;
  if (live && standing!.status !== "provisional") {
    return res.status(409).json({ error: { code: "opening_balance_final", message: "This contract already has a final opening balance. Reverse its receipt to start again." } });
  }
  if (hasOtherPayments(contractId, live?.receiptId ?? null)) {
    return res.status(409).json({ error: { code: "contract_has_payments", message: "This contract already has payments recorded, so it can't be brought up to date this way." } });
  }
  const { open, info } = billsInScope(contractId, parsed.data.asOfDate, live?.receiptId ?? null);
  const plan = planOpening(open, parsed.data.balanceOwedFen, parsed.data.unpaid);
  res.json({ adjusting: !!live, ...describePlan(plan, info, planExtras(contractId, parsed.data.extras)) });
});

const applySchema = inputSchema.extend({ expectedBilledFen: z.number().int(), expectedBillCount: z.number().int() });

function reverseReceipt(tx: Tx, receiptId: number, userId: number) {
  const net = new Map<number, number>();
  for (const a of db.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, receiptId)).all()) net.set(a.chargeId, (net.get(a.chargeId) ?? 0) + a.amountFen);
  for (const [chargeId, amount] of net) {
    if (amount !== 0) tx.insert(receiptAllocations).values({ receiptId, chargeId, amountFen: -amount, createdBy: userId }).run();
  }
  tx.update(receipts).set({ status: "reversed" }).where(eq(receipts.id, receiptId)).run();
}

function postOpening(tx: Tx, contractId: number, userId: number, asOfDate: string, plan: OpeningPlan) {
  let receipt: typeof receipts.$inferSelect | null = null;
  if (plan.paymentFen > 0) {
    receipt = tx
      .insert(receipts)
      .values({ contractId, recordedBy: userId, receivedDate: asOfDate, amountFen: plan.paymentFen, paymentMethod: OPENING_METHOD })
      .returning()
      .get();
    applyAllocations(
      tx,
      contractId,
      userId,
      receipt,
      plan.rows.filter((r) => r.paidFen > 0).map((r) => ({ chargeId: r.chargeId, amountFen: r.paidFen })),
    );
  }
  return receipt;
}

/** A refused opening balance, carrying the HTTP status and code the route answers with. */
export class OpeningError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface OpeningInput {
  asOfDate: string;
  balanceOwedFen: number;
  unpaid?: { chargeId: number; unpaidFen: number }[];
  extras?: OpeningExtra[];
  expectedBilledFen: number;
  expectedBillCount: number;
}

/** Applies a new opening balance, or (adjusting=true) replaces the provisional one. Shared by the
 * single-contract screen and the Go-live batch; throws OpeningError when it can't be done. */
export function performOpening(userId: number, contractId: number, input: OpeningInput, adjusting: boolean) {
  const { asOfDate, balanceOwedFen, unpaid, expectedBilledFen, expectedBillCount } = input;
  const extraPlan = planExtras(contractId, input.extras);
  if (extraPlan.problems.length > 0) throw new OpeningError(400, extraPlan.problems[0].code, PROBLEM_MESSAGES[extraPlan.problems[0].code]);
  const status = db.select({ s: contracts.status }).from(contracts).where(eq(contracts.id, contractId)).get()?.s;
  if (!status) throw new OpeningError(404, "not_found", "Contract not found.");
  if (status === "draft") throw new OpeningError(409, "contract_not_active", "This contract is still a draft. Activate it first.");
  const dateErr = checkDate(contractId, asOfDate);
  if (dateErr) throw new OpeningError(400, "invalid_input", dateErr);

  const live = liveRecord(contractId);
  if (adjusting) {
    if (!live) throw new OpeningError(404, "not_found", "This contract has no opening balance to adjust.");
    if (standingOf(live).status !== "provisional") {
      throw new OpeningError(409, "opening_balance_final", "This opening balance is final and can no longer be adjusted. Reverse its receipt to start again.");
    }
  } else if (live) {
    throw new OpeningError(409, "opening_balance_exists", "This contract already has an opening balance.");
  }
  if (hasOtherPayments(contractId, live?.receiptId ?? null)) {
    throw new OpeningError(409, "contract_has_payments", "This contract already has payments recorded, so it can't be brought up to date this way.");
  }

  const { open } = billsInScope(contractId, asOfDate, live?.receiptId ?? null);
  const plan = planOpening(open, balanceOwedFen, unpaid);
  if (plan.problems.length > 0) throw new OpeningError(400, plan.problems[0], PROBLEM_MESSAGES[plan.problems[0]]);
  if (plan.billedFen !== expectedBilledFen || plan.rows.length !== expectedBillCount) {
    throw new OpeningError(409, "stale_preview", "The bills changed since you previewed this. Open the preview again to see the current figures.");
  }

  try {
    const result = db.transaction((tx) => {
      if (live?.receiptId) reverseReceipt(tx, live.receiptId, userId);
      if (live) voidBroughtForward(tx, live.id, userId, "Opening balance adjusted");
      const receipt = postOpening(tx, contractId, userId, asOfDate, plan);
      const meteredFrom = meteredStartFor(asOfDate);
      const extrasJson = extraPlan.rows.length ? JSON.stringify(extraPlan.rows.map((r) => ({ feeType: r.feeType, amountFen: r.amountFen }))) : null;
      let record: typeof openingBalances.$inferSelect;
      if (live) {
        record = tx
          .update(openingBalances)
          .set({ asOfDate, balanceOwedFen, billedFen: plan.billedFen, receiptId: receipt?.id ?? null, extrasJson, meteredFromSet: meteredFrom })
          .where(eq(openingBalances.id, live.id))
          .returning()
          .get();
      } else {
        record = tx
          .insert(openingBalances)
          .values({ contractId, asOfDate, balanceOwedFen, billedFen: plan.billedFen, receiptId: receipt?.id ?? null, extrasJson, meteredFromSet: meteredFrom, provisionalUntil: provisionalUntil(), createdBy: userId })
          .returning()
          .get();
      }
      // Utility balances the accountant gave become one unpaid bill per item, due on the as-of date; from the
      // as-of month on, metered fees are billed from readings as usual.
      const version = tx.select({ v: contracts.versionNumber }).from(contracts).where(eq(contracts.id, contractId)).get()?.v ?? 1;
      for (const e of extraPlan.rows) {
        tx.insert(charges)
          .values({ contractId, pricingStreamId: e.pricingStreamId, feeType: e.feeType, serviceStart: asOfDate, serviceEnd: asOfDate, dueDate: asOfDate, amountFen: e.amountFen, calculationSnapshotJson: broughtForwardSnapshot(record.id), sourceContractVersion: version })
          .run();
      }
      tx.update(billingRules).set({ meteredBillingFrom: meteredFrom }).where(eq(billingRules.contractId, contractId)).run();
      return record;
    });
    recordAudit({
      actorUserId: userId,
      action: adjusting ? "opening_balance_adjusted" : "opening_balance_applied",
      entityType: "opening_balance",
      entityId: result.id,
      details: {
        contract: contractRef(contractId),
        asOfDate,
        billedFen: plan.billedFen,
        balanceOwedFen,
        paymentFen: plan.paymentFen,
        unpaidBills: plan.rows.filter((r) => r.unpaidFen > 0).length,
        ...(extraPlan.rows.find((e) => e.feeType === "electricity_base") ? { electricityFen: extraPlan.rows.find((e) => e.feeType === "electricity_base")!.amountFen } : {}),
        ...(extraPlan.rows.find((e) => e.feeType === "water") ? { waterFen: extraPlan.rows.find((e) => e.feeType === "water")!.amountFen } : {}),
        ...(adjusting && live ? { previousAsOfDate: live.asOfDate, previousBalanceOwedFen: live.balanceOwedFen } : {}),
      },
    });
    return { record: result, paymentFen: plan.paymentFen };
  } catch (err) {
    if (err instanceof PaymentError) throw new OpeningError(409, "allocation_rejected", err.message);
    throw err;
  }
}

function applyOpening(req: import("express").Request, res: import("express").Response, adjusting: boolean) {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Enter the as-of date and the balance owed." } });
  try {
    const result = performOpening(req.user!.id, contractId, parsed.data, adjusting);
    res.status(adjusting ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof OpeningError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    throw err;
  }
}

openingBalanceRouter.post("/contracts/:id/opening-balance", (req, res) => applyOpening(req, res, false));
openingBalanceRouter.post("/contracts/:id/opening-balance/adjust", (req, res) => applyOpening(req, res, true));

// Close the provisional period early: from then on it can't be adjusted.
openingBalanceRouter.post("/contracts/:id/opening-balance/finalize", (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const live = liveRecord(contractId);
  if (!live) return res.status(404).json({ error: { code: "not_found", message: "This contract has no opening balance." } });
  if (live.status === "final") return res.json({ record: live });
  const updated = db.update(openingBalances).set({ status: "final", finalizedAt: new Date().toISOString() }).where(eq(openingBalances.id, live.id)).returning().get();
  recordAudit({ actorUserId: req.user!.id, action: "opening_balance_finalized", entityType: "opening_balance", entityId: live.id, details: { contract: contractRef(contractId), asOfDate: live.asOfDate, balanceOwedFen: live.balanceOwedFen } });
  res.json({ record: updated });
});

// Take back a provisional opening balance entirely (every bill goes back to what it owed).
openingBalanceRouter.post("/contracts/:id/opening-balance/undo", (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const live = liveRecord(contractId);
  if (!live) return res.status(404).json({ error: { code: "not_found", message: "This contract has no opening balance." } });
  if (standingOf(live).status !== "provisional") {
    return res.status(409).json({ error: { code: "opening_balance_final", message: "This opening balance is final. Reverse its receipt (with a reason) to undo it." } });
  }
  db.transaction((tx) => {
    if (live.receiptId) reverseReceipt(tx, live.receiptId, req.user!.id);
    voidBroughtForward(tx, live.id, req.user!.id, "Opening balance undone");
    restoreMeteredFrom(tx, live);
    tx.update(openingBalances).set({ status: "reversed" }).where(eq(openingBalances.id, live.id)).run();
  });
  recordAudit({ actorUserId: req.user!.id, action: "opening_balance_undone", entityType: "opening_balance", entityId: live.id, details: { contract: contractRef(contractId), asOfDate: live.asOfDate, balanceOwedFen: live.balanceOwedFen } });
  res.json({ ok: true });
});

/** Called when an Admin reverses the opening receipt through the normal receipt reversal. */
export function markOpeningReversedForReceipt(receiptId: number, userId: number): void {
  const row = db.select().from(openingBalances).where(and(eq(openingBalances.receiptId, receiptId), ne(openingBalances.status, "reversed"))).get();
  if (!row) return;
  db.transaction((tx) => {
    voidBroughtForward(tx, row.id, userId, "Opening balance reversed");
    restoreMeteredFrom(tx, row);
    tx.update(openingBalances).set({ status: "reversed" }).where(eq(openingBalances.id, row.id)).run();
  });
}
