import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { receipts, receiptAllocations, charges, billingRules } from "../db/schema.js";
import { isoDate, positiveFen } from "../lib/validate.js";
import { DUPLICATE_PAYMENT_REFERENCE, paymentReferenceUsed } from "../lib/receiptRules.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { contractRef, chargeFacts, receiptFacts } from "../lib/auditDetail.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance, computeUnallocatedFen, validateAllocation } from "../billing/ledger.js";
import { computeLatePenalty } from "../billing/latePenalty.js";
import { canEditEntry, editWindowEnd, EDIT_NOT_YOURS, EDIT_WINDOW_CLOSED, withinEditWindow } from "../lib/editWindow.js";
import { changesBetween } from "../lib/auditDetail.js";
import { PaymentError, reapplyReceipt } from "./payments.js";
import { markOpeningReversedForReceipt } from "./openingBalance.js";
import { OPENING_METHOD } from "../lib/openingBalance.js";
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
    const balance = computeChargeBalance(c, data.adjustments, data.allocations, asOfDate, data.overdueGraceDays);
    return { ...balance, latePenaltyFen: computeLatePenalty(balance.balanceFen, balance.daysOverdue, penaltyRules) };
  });
  const receiptBalances = data.receipts.map((r) => ({ receiptId: r.id, unallocatedFen: computeUnallocatedFen(r, data.allocations) }));

  res.json({
    charges: data.chargesRaw,
    chargeBalances,
    receipts: data.receiptsRaw.map((r) => ({
      ...r,
      // Whether this user can still correct the entry directly, and until when.
      canEdit: r.status === "posted" && r.paymentMethod !== "deposit_transfer" && r.paymentMethod !== OPENING_METHOD && canEditEntry(req.user!, r.recordedBy, r.createdAt),
      editableUntil: r.status === "posted" && r.paymentMethod !== "deposit_transfer" && r.paymentMethod !== OPENING_METHOD ? editWindowEnd(r.createdAt) : null,
    })),
    receiptBalances,
  });
});

// ---------------------------------------------------------------------------
// Recording receipts
// ---------------------------------------------------------------------------

const createReceiptSchema = z.object({
  receivedDate: isoDate,
  amountFen: positiveFen,
  paymentMethod: z.string().trim().min(1).max(50),
  externalReference: z.string().trim().max(100).optional(),
  evidenceDocumentId: z.number().int().optional(),
});

receiptsRouter.post("/contracts/:contractId/receipts", requireRole("admin", "manager", "collector"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  if (rejectIfDraft(res, contractId)) return;

  const parsed = createReceiptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid receipt payload." } });

  if (parsed.data.paymentMethod === OPENING_METHOD) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Opening balances are recorded with Bring up to date." } });
  }
  if (parsed.data.receivedDate > todayInChina()) {
    return res.status(400).json({ error: { code: "future_date", message: "The received date can't be in the future." } });
  }
  if (paymentReferenceUsed(contractId, parsed.data.externalReference)) {
    return res.status(409).json({ error: { code: "duplicate_reference", message: DUPLICATE_PAYMENT_REFERENCE } });
  }

  const inserted = db
    .insert(receipts)
    .values({ contractId, recordedBy: req.user!.id, ...parsed.data })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "receipt_recorded", entityType: "receipt", entityId: inserted.id, details: { contract: contractRef(contractId), amountFen: inserted.amountFen, receivedDate: inserted.receivedDate, paymentMethod: inserted.paymentMethod } });
  res.status(201).json({ receipt: inserted });
});

const editReceiptSchema = z.object({
  receivedDate: isoDate.optional(),
  amountFen: positiveFen.optional(),
  paymentMethod: z.string().trim().min(1).max(50).optional(),
  externalReference: z.string().trim().max(100).nullable().optional(),
});

/** Corrects a payment's date, amount, method or bank reference — for the person who recorded it
 * (or an Admin) during the first 24 hours. If the date or amount changes, what the receipt had
 * paid off is taken back and the new amount is applied again, oldest bill first. */
receiptsRouter.patch("/receipts/:id", requireRole("admin", "manager", "collector"), (req, res) => {
  const id = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;
  if (rejectIfDraft(res, receipt.contractId)) return;
  if (receipt.status !== "posted" || receipt.paymentMethod === "deposit_transfer") {
    return res.status(409).json({ error: { code: "not_editable", message: "This entry can't be edited." } });
  }
  if (receipt.paymentMethod === OPENING_METHOD) {
    return res.status(409).json({ error: { code: "opening_receipt_managed", message: "An opening balance can only be changed from Bring up to date (or reversed)." } });
  }
  if (req.user!.role !== "admin" && req.user!.id !== receipt.recordedBy) {
    return res.status(403).json({ error: { code: "forbidden", message: EDIT_NOT_YOURS } });
  }
  if (!withinEditWindow(receipt.createdAt)) {
    return res.status(409).json({ error: { code: "edit_window_closed", message: EDIT_WINDOW_CLOSED } });
  }

  const parsed = editReceiptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid receipt payload." } });
  const next = { ...receipt, ...parsed.data, externalReference: parsed.data.externalReference === undefined ? receipt.externalReference : parsed.data.externalReference || null };
  if (next.receivedDate > todayInChina()) {
    return res.status(400).json({ error: { code: "future_date", message: "The received date can't be in the future." } });
  }
  if (paymentReferenceUsed(receipt.contractId, next.externalReference, id)) {
    return res.status(409).json({ error: { code: "duplicate_reference", message: DUPLICATE_PAYMENT_REFERENCE } });
  }

  const moneyChanged = next.amountFen !== receipt.amountFen || next.receivedDate !== receipt.receivedDate;
  const hasAllocations = db.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, id)).all().some((a) => a.amountFen !== 0);
  try {
    const updated = db.transaction((tx) => {
      const row = tx
        .update(receipts)
        .set({ receivedDate: next.receivedDate, amountFen: next.amountFen, paymentMethod: next.paymentMethod, externalReference: next.externalReference })
        .where(eq(receipts.id, id))
        .returning()
        .get();
      if (moneyChanged && hasAllocations) reapplyReceipt(tx, receipt.contractId, req.user!.id, row);
      return row;
    });
    recordAudit({
      actorUserId: req.user!.id,
      action: "receipt_edited",
      entityType: "receipt",
      entityId: id,
      details: { contract: contractRef(receipt.contractId), changes: changesBetween(receipt, updated), ...(moneyChanged && hasAllocations ? { reapplied: true } : {}) },
    });
    res.json({ receipt: updated });
  } catch (err) {
    if (err instanceof PaymentError) return res.status(409).json({ error: { code: "allocation_rejected", message: err.message } });
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Allocating a receipt to a charge
// ---------------------------------------------------------------------------

const allocateSchema = z.object({ chargeId: z.number().int(), amountFen: positiveFen });

receiptsRouter.post("/receipts/:id/allocate", requireRole("admin", "manager", "collector"), (req, res) => {
  const receiptId = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;
  if (rejectIfDraft(res, receipt.contractId)) return;

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

  recordAudit({ actorUserId: req.user!.id, action: "receipt_allocated", entityType: "receipt_allocation", entityId: inserted.id, details: { receiptId, ...chargeFacts(parsed.data.chargeId), amountFen: parsed.data.amountFen } });
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
  if (db.select().from(receipts).where(eq(receipts.id, allocation.receiptId)).get()?.paymentMethod === OPENING_METHOD) {
    return res.status(409).json({ error: { code: "opening_receipt_managed", message: "An opening balance can only be changed from Bring up to date (or reversed as a whole)." } });
  }

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

  recordAudit({ actorUserId: req.user!.id, action: "receipt_allocation_reversed", entityType: "receipt_allocation", entityId: id, reason, details: { ...chargeFacts(allocation.chargeId), ...receiptFacts(allocation.receiptId), amountFen: allocation.amountFen } });
  res.status(201).json({ reversal });
});

/** Reverses an entire receipt (e.g. a bounced check) rather than one
 * allocation: cascades a reversal across every charge it was ever applied
 * to (netting out any prior partial reversal first, so this is safe to
 * call regardless of allocation history) before marking the receipt itself
 * reversed. Everything is additive rows, never an edit — matching the
 * brief's "linked history retained, balances correct" requirement. */
/** Takes back what a receipt had paid off and marks it reversed. Returns the allocation reversals made. */
function reverseReceiptCore(receiptId: number, userId: number, removedAt: string | null) {
  const allocations = db.select().from(receiptAllocations).where(eq(receiptAllocations.receiptId, receiptId)).all();
  const netByCharge = new Map<number, number>();
  for (const a of allocations) netByCharge.set(a.chargeId, (netByCharge.get(a.chargeId) ?? 0) + a.amountFen);

  return db.transaction((tx) => {
    const created: (typeof receiptAllocations.$inferSelect)[] = [];
    for (const [chargeId, net] of netByCharge) {
      if (net === 0) continue;
      created.push(tx.insert(receiptAllocations).values({ receiptId, chargeId, amountFen: -net, createdBy: userId }).returning().get());
    }
    tx.update(receipts).set({ status: "reversed", ...(removedAt ? { removedAt } : {}) }).where(eq(receipts.id, receiptId)).run();
    return created;
  });
}

receiptsRouter.post("/receipts/:id/reverse", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;
  if (rejectIfDraft(res, receipt.contractId)) return;
  if (receipt.status === "reversed") {
    return res.status(409).json({ error: { code: "already_reversed", message: "This receipt has already been reversed." } });
  }

  const reason = req.body?.reason as string | undefined;
  if (!reason) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required to reverse a receipt." } });

  const reversals = reverseReceiptCore(id, req.user!.id, null);
  if (receipt.paymentMethod === OPENING_METHOD) markOpeningReversedForReceipt(id, req.user!.id);

  recordAudit({
    actorUserId: req.user!.id,
    action: "receipt_reversed",
    entityType: "receipt",
    entityId: id,
    reason,
    details: { ...receiptFacts(id), reversedAllocationCount: reversals.length },
  });
  res.status(200).json({ reversals });
});

/** Removes a receipt entered by mistake: the person who recorded it (or an Admin) can do this, without a reason,
 * during the first 24 hours. It takes back what the receipt had paid off and keeps the record, marked Removed. */
receiptsRouter.post("/receipts/:id/remove", requireRole("admin", "manager", "collector"), (req, res) => {
  const id = Number(req.params.id);
  const receipt = db.select().from(receipts).where(eq(receipts.id, id)).get();
  if (!receipt) return res.status(404).json({ error: { code: "not_found", message: "Receipt not found." } });
  if (!ensureContractAccess(req, res, receipt.contractId)) return;
  if (rejectIfDraft(res, receipt.contractId)) return;
  if (receipt.status !== "posted" || receipt.paymentMethod === "deposit_transfer" || receipt.paymentMethod === OPENING_METHOD) {
    return res.status(409).json({ error: { code: "not_editable", message: "This entry can't be removed." } });
  }
  if (req.user!.role !== "admin" && req.user!.id !== receipt.recordedBy) {
    return res.status(403).json({ error: { code: "forbidden", message: EDIT_NOT_YOURS } });
  }
  if (!withinEditWindow(receipt.createdAt)) {
    return res.status(409).json({ error: { code: "edit_window_closed", message: EDIT_WINDOW_CLOSED } });
  }

  const reversals = reverseReceiptCore(id, req.user!.id, new Date().toISOString());
  recordAudit({
    actorUserId: req.user!.id,
    action: "receipt_removed",
    entityType: "receipt",
    entityId: id,
    details: { ...receiptFacts(id), reversedAllocationCount: reversals.length },
  });
  res.status(200).json({ reversals });
});
