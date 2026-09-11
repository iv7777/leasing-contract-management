import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { receipts, receiptAllocations, charges, billingRules } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance, computeUnallocatedFen, validateAllocation } from "../billing/ledger.js";
import { computeLatePenalty } from "../billing/latePenalty.js";
import { todayInChina } from "@lcm/shared";

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

function ensureContractAccess(req: import("express").Request, res: import("express").Response, contractId: number): boolean {
  if (!canAccessContract(req.user!, contractId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ledger view: charges with computed balances, receipts with unallocated credit
// ---------------------------------------------------------------------------

receiptsRouter.get("/contracts/:contractId/ledger", (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;

  const asOfDate = (req.query.asOf as string) ?? todayInChina();
  const data = loadLedgerInputs(contractId);

  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, contractId)).get();
  const penaltyRules = {
    enabled: rules?.latePenaltyEnabled ?? false,
    dailyRatePermille: rules?.latePenaltyDailyRatePermille ?? null,
    capFen: rules?.latePenaltyCapFen ?? null,
  };

  const chargeBalances = data.charges.map((c) => {
    const balance = computeChargeBalance(c, data.adjustments, data.allocations, asOfDate);
    return { ...balance, latePenaltyFen: computeLatePenalty(balance.balanceFen, balance.daysOverdue, penaltyRules) };
  });
  const receiptBalances = data.receipts.map((r) => ({ receiptId: r.id, unallocatedFen: computeUnallocatedFen(r, data.allocations) }));

  res.json({
    charges: data.chargesRaw,
    chargeBalances,
    receipts: data.receiptsRaw,
    receiptBalances,
  });
});

// ---------------------------------------------------------------------------
// Recording receipts
// ---------------------------------------------------------------------------

const createReceiptSchema = z.object({
  receivedDate: z.string(),
  amountFen: z.number().positive(),
  paymentMethod: z.string().min(1),
  externalReference: z.string().optional(),
  evidenceDocumentId: z.number().optional(),
});

receiptsRouter.post("/contracts/:contractId/receipts", requireRole("admin", "manager", "collector"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;

  const parsed = createReceiptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid receipt payload." } });

  const inserted = db
    .insert(receipts)
    .values({ contractId, recordedBy: req.user!.id, ...parsed.data })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "receipt_recorded", entityType: "receipt", entityId: inserted.id, details: { amountFen: inserted.amountFen } });
  res.status(201).json({ receipt: inserted });
});

// ---------------------------------------------------------------------------
// Allocating a receipt to a charge
// ---------------------------------------------------------------------------

const allocateSchema = z.object({ chargeId: z.number(), amountFen: z.number().positive() });

receiptsRouter.post("/receipts/:id/allocate", requireRole("admin", "manager", "collector"), (req, res) => {
  const receiptId = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;

  const parsed = allocateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid allocation payload." } });

  const charge = db.select().from(charges).where(eq(charges.id, parsed.data.chargeId)).get();
  if (!charge) return res.status(404).json({ error: { code: "not_found", message: "Charge not found." } });
  if (charge.contractId !== receipt.contractId) {
    return res.status(400).json({ error: { code: "cross_contract", message: "A receipt can only be allocated to a charge on the same contract." } });
  }

  const data = loadLedgerInputs(receipt.contractId);
  const validation = validateAllocation({
    receipt: { id: receipt.id, amountFen: receipt.amountFen, status: receipt.status },
    existingReceiptAllocations: data.allocations,
    charge: { id: charge.id, amountFen: charge.amountFen, dueDate: charge.dueDate, serviceStart: charge.serviceStart, serviceEnd: charge.serviceEnd, status: charge.status },
    chargeAdjustments: data.adjustments,
    existingChargeAllocations: data.allocations,
    amountFen: parsed.data.amountFen,
    asOfDate: todayInChina(),
  });
  if (!validation.ok) return res.status(409).json({ error: { code: "allocation_rejected", message: validation.reason } });

  const inserted = db
    .insert(receiptAllocations)
    .values({ receiptId, chargeId: parsed.data.chargeId, amountFen: parsed.data.amountFen, createdBy: req.user!.id })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "receipt_allocated", entityType: "receipt_allocation", entityId: inserted.id, details: { receiptId, chargeId: parsed.data.chargeId, amountFen: parsed.data.amountFen } });
  res.status(201).json({ allocation: inserted });
});

receiptsRouter.post("/receipt-allocations/:id/reverse", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const allocation = db.select().from(receiptAllocations).where(eq(receiptAllocations.id, id)).get();
  if (!allocation) return res.status(404).json({ error: { code: "not_found", message: "Allocation not found." } });

  const alreadyReversed = db.select().from(receiptAllocations).all().some((a) => a.reversalOfId === id);
  if (alreadyReversed) return res.status(409).json({ error: { code: "already_reversed", message: "This allocation has already been reversed." } });

  const reason = req.body?.reason as string | undefined;
  if (!reason) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required to reverse an allocation." } });

  const reversal = db
    .insert(receiptAllocations)
    .values({
      receiptId: allocation.receiptId,
      chargeId: allocation.chargeId,
      amountFen: -allocation.amountFen,
      reversalOfId: id,
      createdBy: req.user!.id,
    })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "receipt_allocation_reversed", entityType: "receipt_allocation", entityId: id, reason });
  res.status(201).json({ reversal });
});

/** Reverses an entire receipt (e.g. a bounced check) rather than one
 * allocation: cascades a reversal across every charge it was ever applied
 * to (netting out any prior partial reversal first, so this is safe to
 * call regardless of allocation history) before marking the receipt itself
 * reversed. Everything is additive rows, never an edit — matching the
 * brief's "linked history retained, balances correct" requirement. */
receiptsRouter.post("/receipts/:id/reverse", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;
  if (receipt.status === "reversed") {
    return res.status(409).json({ error: { code: "already_reversed", message: "This receipt has already been reversed." } });
  }

  const reason = req.body?.reason as string | undefined;
  if (!reason) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required to reverse a receipt." } });

  const allocations = db.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, id)).all();
  const netByCharge = new Map<number, number>();
  for (const a of allocations) netByCharge.set(a.chargeId, (netByCharge.get(a.chargeId) ?? 0) + a.amountFen);

  const reversals = db.transaction((tx) => {
    const created: (typeof receiptAllocations.$inferSelect)[] = [];
    for (const [chargeId, net] of netByCharge) {
      if (net === 0) continue;
      created.push(
        tx
          .insert(receiptAllocations)
          .values({ receiptId: id, chargeId, amountFen: -net, createdBy: req.user!.id })
          .returning()
          .get(),
      );
    }
    tx.update(receipts).set({ status: "reversed" }).where(eq(receipts.id, id)).run();
    return created;
  });

  recordAudit({
    actorUserId: req.user!.id,
    action: "receipt_reversed",
    entityType: "receipt",
    entityId: id,
    reason,
    details: { reversedAllocationCount: reversals.length },
  });
  res.status(200).json({ reversals });
});
