import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { receipts, receiptAllocations } from "../db/schema.js";
import { isoDate, positiveFen } from "../lib/validate.js";
import { DUPLICATE_PAYMENT_REFERENCE, paymentReferenceUsed } from "../lib/receiptRules.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { contractRef, chargeFacts } from "../lib/auditDetail.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance, validateAllocation } from "../billing/ledger.js";
import { proposeAllocations, type OpenCharge } from "../billing/allocation.js";
import { todayInChina } from "@lcm/shared";

/** Recording payments the way staff actually think about them: "the tenant
 * paid X on this date" — the money is applied to what they owe, oldest first,
 * in one step, instead of creating a receipt and then allocating it charge
 * by charge. Each payment is still a normal receipt with normal allocations,
 * so the ledger, reversals and audit trail work exactly as before. */
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const WRITERS = ["admin", "manager", "collector"] as const;

export class PaymentError extends Error {}


const paymentSchema = z.object({
  receivedDate: isoDate,
  amountFen: positiveFen,
  paymentMethod: z.string().trim().min(1).max(50),
  externalReference: z.string().trim().max(100).optional(),
});

export function openChargesFor(contractId: number, asOf: string): { open: OpenCharge[]; info: Map<number, { feeType: string; serviceStart: string; serviceEnd: string; dueDate: string; balanceFen: number }> } {
  const data = loadLedgerInputs(contractId);
  const info = new Map<number, { feeType: string; serviceStart: string; serviceEnd: string; dueDate: string; balanceFen: number }>();
  const open: OpenCharge[] = [];
  for (const c of data.charges) {
    if (c.status !== "posted") continue;
    const balance = computeChargeBalance(c, data.adjustments, data.allocations, asOf, data.overdueGraceDays);
    if (balance.balanceFen <= 0) continue;
    const raw = data.chargesRaw.find((x) => x.id === c.id)!;
    open.push({ chargeId: c.id, dueDate: c.dueDate, serviceStart: c.serviceStart, balanceFen: balance.balanceFen });
    info.set(c.id, { feeType: raw.feeType, serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, dueDate: c.dueDate, balanceFen: balance.balanceFen });
  }
  return { open, info };
}

type Payment = z.infer<typeof paymentSchema>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Applies a receipt's money to charges, validating each row against the live ledger
 * (including rows just written in this call). Throws PaymentError on a rejected row. */
export function applyAllocations(
  tx: Tx,
  contractId: number,
  userId: number,
  receipt: { id: number; amountFen: number; status: string },
  allocations: { chargeId: number; amountFen: number }[],
) {
  const asOf = todayInChina();
  for (const a of allocations) {
    const data = loadLedgerInputs(contractId);
    const charge = data.charges.find((c) => c.id === a.chargeId);
    if (!charge) throw new PaymentError(`Charge ${a.chargeId} does not belong to this contract.`);
    const validation = validateAllocation({
      receipt: { id: receipt.id, amountFen: receipt.amountFen, status: receipt.status as "posted" | "reversed" },
      existingReceiptAllocations: data.allocations,
      charge,
      chargeAdjustments: data.adjustments,
      existingChargeAllocations: data.allocations,
      amountFen: a.amountFen,
      asOfDate: asOf,
    });
    if (!validation.ok) throw new PaymentError(validation.reason);
    const inserted = tx.insert(receiptAllocations).values({ receiptId: receipt.id, chargeId: a.chargeId, amountFen: a.amountFen, createdBy: userId }).returning().get();
    recordAudit({ actorUserId: userId, action: "receipt_allocated", entityType: "receipt_allocation", entityId: inserted.id, details: { receiptId: receipt.id, ...chargeFacts(a.chargeId), amountFen: a.amountFen } });
  }
}

/** Takes back whatever a receipt currently has applied (as additive reversal rows) and applies
 * its amount again, oldest bill first. Used when a receipt is corrected. */
export function reapplyReceipt(tx: Tx, contractId: number, userId: number, receipt: { id: number; amountFen: number; status: string }) {
  const rows = db.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, receipt.id)).all();
  const net = new Map<number, number>();
  for (const a of rows) net.set(a.chargeId, (net.get(a.chargeId) ?? 0) + a.amountFen);
  for (const [chargeId, amount] of net) {
    if (amount !== 0) tx.insert(receiptAllocations).values({ receiptId: receipt.id, chargeId, amountFen: -amount, createdBy: userId }).run();
  }
  const proposal = proposeAllocations(openChargesFor(contractId, todayInChina()).open, receipt.amountFen).allocations;
  applyAllocations(tx, contractId, userId, receipt, proposal);
}


/** Inserts the receipt and its allocations, validating every allocation
 * against the live ledger (including ones just written in this call). Must
 * run inside a transaction so a rejected allocation leaves nothing behind. */
function postPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  contractId: number,
  userId: number,
  p: Payment,
  allocations: { chargeId: number; amountFen: number }[],
) {
  if (paymentReferenceUsed(contractId, p.externalReference)) throw new PaymentError(DUPLICATE_PAYMENT_REFERENCE);
  const receipt = tx
    .insert(receipts)
    .values({ contractId, recordedBy: userId, receivedDate: p.receivedDate, amountFen: p.amountFen, paymentMethod: p.paymentMethod, externalReference: p.externalReference?.trim() || null })
    .returning()
    .get();
  recordAudit({ actorUserId: userId, action: "receipt_recorded", entityType: "receipt", entityId: receipt.id, details: { contract: contractRef(contractId), amountFen: receipt.amountFen, receivedDate: receipt.receivedDate, paymentMethod: receipt.paymentMethod } });

  applyAllocations(tx, contractId, userId, receipt, allocations);
  return receipt;
}

function guard(req: import("express").Request, res: import("express").Response, contractId: number): boolean {
  if (!canAccessContract(req.user!, contractId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return false;
  }
  return !rejectIfDraft(res, contractId);
}

// Preview how a payment would be applied, without recording anything.
paymentsRouter.post("/contracts/:id/payments/preview", requireRole(...WRITERS), (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const parsed = z.object({ amountFen: positiveFen }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Enter a payment amount." } });

  const { open, info } = openChargesFor(contractId, todayInChina());
  const proposal = proposeAllocations(open, parsed.data.amountFen);
  const proposed = new Map(proposal.allocations.map((a) => [a.chargeId, a.amountFen]));
  res.json({
    allocations: proposal.allocations.map((a) => ({ ...a, ...info.get(a.chargeId)! })),
    // Every unpaid bill, oldest first, with what the proposal would put on it (0 when the amount doesn't reach it).
    openCharges: open.map((o) => ({ chargeId: o.chargeId, ...info.get(o.chargeId)!, amountFen: proposed.get(o.chargeId) ?? 0 })),
    unallocatedFen: proposal.unallocatedFen,
    openChargeCount: open.length,
  });
});

const recordSchema = paymentSchema.extend({
  // Omit to apply oldest-first automatically; pass to use an edited split.
  allocations: z.array(z.object({ chargeId: z.number().int(), amountFen: z.number().int().positive() })).optional(),
});

paymentsRouter.post("/contracts/:id/payments", requireRole(...WRITERS), (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid payment." } });
  const { allocations: given, ...payment } = parsed.data;
  if (payment.receivedDate > todayInChina()) {
    return res.status(400).json({ error: { code: "future_date", message: "The received date can't be in the future." } });
  }

  try {
    const result = db.transaction((tx) => {
      const allocations = given ?? proposeAllocations(openChargesFor(contractId, todayInChina()).open, payment.amountFen).allocations;
      const sum = allocations.reduce((s, a) => s + a.amountFen, 0);
      if (sum > payment.amountFen) throw new PaymentError("The allocations add up to more than the payment.");
      const receipt = postPayment(tx, contractId, req.user!.id, payment, allocations);
      return { receipt, allocatedFen: sum, unallocatedFen: payment.amountFen - sum, allocationCount: allocations.length };
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof PaymentError) return res.status(409).json({ error: { code: "allocation_rejected", message: err.message } });
    throw err;
  }
});

// Many historical payments at once (bringing an existing tenant's account
// current). Applied in date order, each oldest-first; all-or-nothing.
const bulkSchema = z.object({ payments: z.array(paymentSchema).min(1).max(500) });

paymentsRouter.post("/contracts/:id/payments/bulk", requireRole(...WRITERS), (req, res) => {
  const contractId = Number(req.params.id);
  if (!guard(req, res, contractId)) return;
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Check the payment rows (date, amount and method are required)." } });

  const today = todayInChina();
  const future = parsed.data.payments.findIndex((p) => p.receivedDate > today);
  if (future >= 0) {
    return res.status(400).json({ error: { code: "future_date", message: `Row ${future + 1}: the received date can't be in the future.`, row: future + 1 } });
  }

  const order = parsed.data.payments.map((p, i) => ({ p, i })).sort((a, b) => a.p.receivedDate.localeCompare(b.p.receivedDate) || a.i - b.i);

  try {
    const rows = db.transaction((tx) => {
      const out: { row: number; receiptId: number; allocatedFen: number; unallocatedFen: number }[] = [];
      for (const { p, i } of order) {
        const allocations = proposeAllocations(openChargesFor(contractId, today).open, p.amountFen).allocations;
        const receipt = postPayment(tx, contractId, req.user!.id, p, allocations);
        const allocated = allocations.reduce((s, a) => s + a.amountFen, 0);
        out.push({ row: i + 1, receiptId: receipt.id, allocatedFen: allocated, unallocatedFen: p.amountFen - allocated });
      }
      return out.sort((a, b) => a.row - b.row);
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "payments_bulk_recorded",
      entityType: "contract",
      entityId: contractId,
      details: { contract: contractRef(contractId), count: rows.length, totalFen: parsed.data.payments.reduce((s, p) => s + p.amountFen, 0) },
    });
    res.status(201).json({ results: rows });
  } catch (err) {
    if (err instanceof PaymentError) return res.status(409).json({ error: { code: "allocation_rejected", message: err.message } });
    throw err;
  }
});
