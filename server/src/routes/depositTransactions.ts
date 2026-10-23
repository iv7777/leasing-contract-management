import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, depositTransactions, receipts, receiptAllocations, charges } from "../db/schema.js";
import { isoDate, positiveFen } from "../lib/validate.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { contractRef, chargeFacts } from "../lib/auditDetail.js";
import { computeDepositBalance, validateAllocation } from "../billing/ledger.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { loadDepositStatus } from "../billing/depositLoad.js";
import { canEditEntry, editWindowEnd, EDIT_NOT_YOURS, EDIT_WINDOW_CLOSED, withinEditWindow } from "../lib/editWindow.js";
import { changesBetween } from "../lib/auditDetail.js";
import { todayInChina } from "@lcm/shared";

export const depositTransactionsRouter = Router();
depositTransactionsRouter.use(requireAuth);

function ensureContractAccess(req: import("express").Request, res: import("express").Response, contractId: number): boolean {
  if (!canAccessContract(req.user!, contractId)) {
    res.status(403).json({ error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } });
    return false;
  }
  return true;
}

depositTransactionsRouter.get("/contracts/:contractId/deposit-transactions", (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  const rows = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contractId)).all();
  const balanceFen = computeDepositBalance(
    rows.map((r) => ({ amountFen: r.amountFen, transactionDate: r.transactionDate })),
    todayInChina(),
  );
  // A shortfall only means something once the lease is in force; a draft has none.
  const contract = db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contractId)).get();
  const loaded = loadDepositStatus(contractId, todayInChina());
  const status = contract?.status === "active" ? loaded : { ...loaded, shortfallFen: 0, needsManualCheck: false, state: "none" as const };
  const reversedIds = new Set(rows.filter((r) => r.reversalOfId !== null).map((r) => r.reversalOfId));
  // A plain deposit receipt, refund or deduction can be corrected for 24 hours by whoever recorded it (or an Admin).
  const editable = (r: (typeof rows)[number]) => ["receipt", "refund", "deduction"].includes(r.transactionType) && r.reversalOfId === null && !reversedIds.has(r.id);
  res.json({
    transactions: rows.map((r) => ({
      ...r,
      canEdit: editable(r) && canEditEntry(req.user!, r.actorUserId, r.createdAt),
      editableUntil: editable(r) ? editWindowEnd(r.createdAt) : null,
    })),
    balanceFen,
    status,
  });
});

const receiptTxnSchema = z.object({
  transactionType: z.literal("receipt"),
  amountFen: positiveFen,
  transactionDate: isoDate,
  receiptId: z.number().int().optional(),
  reason: z.string().trim().min(1).max(500),
});

/** Admin-only per brief §6/§8: deposit deductions, refunds, and transfers to
 * rent require Admin approval and linked entries, without double-counting
 * the money. A transfer_to_rent creates a synthetic receipt so the same
 * allocation machinery (and its over-allocation guard) applies to it. */
const adminTxnSchema = z.object({
  transactionType: z.enum(["refund", "deduction"]),
  amountFen: positiveFen,
  transactionDate: isoDate,
  reason: z.string().trim().min(1).max(500),
});

const transferSchema = z.object({
  transactionType: z.literal("transfer_to_rent"),
  amountFen: positiveFen,
  transactionDate: isoDate,
  chargeId: z.number().int(),
  reason: z.string().trim().min(1).max(500),
});

depositTransactionsRouter.post("/contracts/:contractId/deposit-transactions", requireRole("admin", "manager", "collector"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;
  if (rejectIfDraft(res, contractId)) return;

  const type = req.body?.transactionType;

  if (type === "receipt") {
    const parsed = receiptTxnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit receipt payload." } });
    const inserted = db
      .insert(depositTransactions)
      .values({ contractId, transactionType: "receipt", amountFen: parsed.data.amountFen, transactionDate: parsed.data.transactionDate, receiptId: parsed.data.receiptId ?? null, reason: parsed.data.reason, actorUserId: req.user!.id })
      .returning()
      .get();
    recordAudit({ actorUserId: req.user!.id, action: "deposit_received", entityType: "deposit_transaction", entityId: inserted.id, details: { contract: contractRef(contractId), amountFen: inserted.amountFen, transactionDate: inserted.transactionDate } });
    return res.status(201).json({ transaction: inserted });
  }

  if (type === "refund" || type === "deduction") {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only Admin can record a deposit refund or deduction." } });
    }
    const parsed = adminTxnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit transaction payload." } });

    const rows = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contractId)).all();
    const heldFen = computeDepositBalance(rows.map((r) => ({ amountFen: r.amountFen, transactionDate: r.transactionDate })), parsed.data.transactionDate);
    if (parsed.data.amountFen > heldFen) {
      return res.status(409).json({ error: { code: "insufficient_deposit", message: `Only ${(heldFen / 100).toFixed(2)} yuan is held; cannot ${type} ${(parsed.data.amountFen / 100).toFixed(2)} yuan.` } });
    }

    const inserted = db
      .insert(depositTransactions)
      .values({ contractId, transactionType: parsed.data.transactionType, amountFen: -parsed.data.amountFen, transactionDate: parsed.data.transactionDate, reason: parsed.data.reason, actorUserId: req.user!.id, approvedBy: req.user!.id })
      .returning()
      .get();
    recordAudit({ actorUserId: req.user!.id, action: `deposit_${type}`, entityType: "deposit_transaction", entityId: inserted.id, reason: parsed.data.reason, details: { contract: contractRef(contractId), amountFen: parsed.data.amountFen, transactionDate: parsed.data.transactionDate } });
    return res.status(201).json({ transaction: inserted });
  }

  if (type === "transfer_to_rent") {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only Admin can transfer held deposit to rent." } });
    }
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid transfer payload." } });

    const rows = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contractId)).all();
    const heldFen = computeDepositBalance(rows.map((r) => ({ amountFen: r.amountFen, transactionDate: r.transactionDate })), parsed.data.transactionDate);
    if (parsed.data.amountFen > heldFen) {
      return res.status(409).json({ error: { code: "insufficient_deposit", message: `Only ${(heldFen / 100).toFixed(2)} yuan is held; cannot transfer ${(parsed.data.amountFen / 100).toFixed(2)} yuan.` } });
    }

    const charge = db.select().from(charges).where(eq(charges.id, parsed.data.chargeId)).get();
    if (!charge || charge.contractId !== contractId) {
      return res.status(404).json({ error: { code: "not_found", message: "Charge not found on this contract." } });
    }

    const data = loadLedgerInputs(contractId);
    // A transfer moves already-held money, but it still goes through the
    // same receipt+allocation machinery so the charge ledger has one
    // consistent source of truth for what paid it down.
    const syntheticReceipt = db
      .insert(receipts)
      .values({ contractId, receivedDate: parsed.data.transactionDate, amountFen: parsed.data.amountFen, paymentMethod: "deposit_transfer", recordedBy: req.user!.id })
      .returning()
      .get();

    const validation = validateAllocation({
      receipt: { id: syntheticReceipt.id, amountFen: syntheticReceipt.amountFen, status: "posted" },
      existingReceiptAllocations: [],
      charge: { id: charge.id, amountFen: charge.amountFen, dueDate: charge.dueDate, serviceStart: charge.serviceStart, serviceEnd: charge.serviceEnd, status: charge.status },
      chargeAdjustments: data.adjustments,
      existingChargeAllocations: data.allocations,
      amountFen: parsed.data.amountFen,
      asOfDate: todayInChina(),
    });
    if (!validation.ok) {
      db.delete(receipts).where(eq(receipts.id, syntheticReceipt.id)).run();
      return res.status(409).json({ error: { code: "allocation_rejected", message: validation.reason } });
    }

    db.insert(receiptAllocations).values({ receiptId: syntheticReceipt.id, chargeId: charge.id, amountFen: parsed.data.amountFen, createdBy: req.user!.id }).run();

    const inserted = db
      .insert(depositTransactions)
      .values({
        contractId,
        transactionType: "transfer_to_rent",
        amountFen: -parsed.data.amountFen,
        transactionDate: parsed.data.transactionDate,
        receiptId: syntheticReceipt.id,
        chargeId: charge.id,
        reason: parsed.data.reason,
        actorUserId: req.user!.id,
        approvedBy: req.user!.id,
      })
      .returning()
      .get();

    recordAudit({ actorUserId: req.user!.id, action: "deposit_transferred_to_rent", entityType: "deposit_transaction", entityId: inserted.id, details: { contract: contractRef(contractId), amountFen: parsed.data.amountFen, ...chargeFacts(charge.id) } });
    return res.status(201).json({ transaction: inserted });
  }

  res.status(400).json({ error: { code: "invalid_input", message: "Unknown transactionType." } });
});

const editDepositSchema = z.object({
  transactionDate: isoDate.optional(),
  amountFen: positiveFen.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

depositTransactionsRouter.patch("/deposit-transactions/:id", requireRole("admin", "manager", "collector"), (req, res) => {
  const id = Number(req.params.id);
  const original = db.select().from(depositTransactions).where(eq(depositTransactions.id, id)).get();
  if (!original) return res.status(404).json({ error: { code: "not_found", message: "Deposit transaction not found." } });
  if (!ensureContractAccess(req, res, original.contractId)) return;
  if (rejectIfDraft(res, original.contractId)) return;

  const all = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, original.contractId)).all();
  const reversed = all.some((t) => t.reversalOfId === id);
  if (!["receipt", "refund", "deduction"].includes(original.transactionType) || original.reversalOfId !== null || reversed) {
    return res.status(409).json({ error: { code: "not_editable", message: "This entry can't be edited." } });
  }
  if (req.user!.role !== "admin" && req.user!.id !== original.actorUserId) {
    return res.status(403).json({ error: { code: "forbidden", message: EDIT_NOT_YOURS } });
  }
  if (!withinEditWindow(original.createdAt)) {
    return res.status(409).json({ error: { code: "edit_window_closed", message: EDIT_WINDOW_CLOSED } });
  }

  const parsed = editDepositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit transaction payload." } });
  const sign = original.amountFen < 0 ? -1 : 1;
  const next = {
    ...original,
    transactionDate: parsed.data.transactionDate ?? original.transactionDate,
    reason: parsed.data.reason ?? original.reason,
    amountFen: parsed.data.amountFen !== undefined ? sign * parsed.data.amountFen : original.amountFen,
  };

  // The deposit held may never go below zero, on the new date or at any later time.
  const others = all.filter((t) => t.id !== id).map((t) => ({ amountFen: t.amountFen, transactionDate: t.transactionDate }));
  const heldAt = (asOf: string) => computeDepositBalance([...others, { amountFen: next.amountFen, transactionDate: next.transactionDate }], asOf);
  const checkDates = [next.transactionDate, ...all.map((t) => t.transactionDate), "9999-12-31"].filter((d) => d >= next.transactionDate);
  const worst = Math.min(...checkDates.map(heldAt));
  if (worst < 0) {
    return res.status(409).json({ error: { code: "insufficient_deposit", message: "This change would take the deposit held below zero." } });
  }

  const updated = db
    .update(depositTransactions)
    .set({ transactionDate: next.transactionDate, amountFen: next.amountFen, reason: next.reason })
    .where(eq(depositTransactions.id, id))
    .returning()
    .get();
  recordAudit({
    actorUserId: req.user!.id,
    action: "deposit_transaction_edited",
    entityType: "deposit_transaction",
    entityId: id,
    details: { contract: contractRef(original.contractId), changes: changesBetween(original, updated) },
  });
  res.json({ transaction: updated });
});

/** Removes a deposit entry made by mistake: the person who recorded it (or an Admin) can do this, without a reason,
 * during the first 24 hours. It adds a reversal dated the same day as the entry (so nothing in between changes)
 * and keeps both rows, marked Removed. */
depositTransactionsRouter.post("/deposit-transactions/:id/remove", requireRole("admin", "manager", "collector"), (req, res) => {
  const id = Number(req.params.id);
  const original = db.select().from(depositTransactions).where(eq(depositTransactions.id, id)).get();
  if (!original) return res.status(404).json({ error: { code: "not_found", message: "Deposit transaction not found." } });
  if (!ensureContractAccess(req, res, original.contractId)) return;
  if (rejectIfDraft(res, original.contractId)) return;

  const all = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, original.contractId)).all();
  if (!["receipt", "refund", "deduction"].includes(original.transactionType) || original.reversalOfId !== null || all.some((t) => t.reversalOfId === id)) {
    return res.status(409).json({ error: { code: "not_editable", message: "This entry can't be removed." } });
  }
  if (req.user!.role !== "admin" && req.user!.id !== original.actorUserId) {
    return res.status(403).json({ error: { code: "forbidden", message: EDIT_NOT_YOURS } });
  }
  if (!withinEditWindow(original.createdAt)) {
    return res.status(409).json({ error: { code: "edit_window_closed", message: EDIT_WINDOW_CLOSED } });
  }

  // Taking a deposit receipt back must not leave the deposit held below zero, now or at any later time.
  const others = all.filter((t) => t.id !== id).map((t) => ({ amountFen: t.amountFen, transactionDate: t.transactionDate }));
  const checkDates = [...all.map((t) => t.transactionDate), "9999-12-31"].filter((d) => d >= original.transactionDate);
  if (Math.min(...checkDates.map((d) => computeDepositBalance(others, d))) < 0) {
    return res.status(409).json({ error: { code: "insufficient_deposit", message: "Removing this entry would take the deposit held below zero." } });
  }

  const reversal = db
    .insert(depositTransactions)
    .values({
      contractId: original.contractId,
      transactionType: "reversal",
      amountFen: -original.amountFen,
      transactionDate: original.transactionDate,
      reversalOfId: id,
      reason: "Removed",
      actorUserId: req.user!.id,
      approvedBy: req.user!.id,
      removedAt: new Date().toISOString(),
    })
    .returning()
    .get();
  recordAudit({ actorUserId: req.user!.id, action: "deposit_transaction_removed", entityType: "deposit_transaction", entityId: id, details: { contract: contractRef(original.contractId), originalType: original.transactionType, amountFen: original.amountFen, transactionDate: original.transactionDate } });
  res.status(201).json({ reversal });
});

depositTransactionsRouter.post("/deposit-transactions/:id/reverse", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const original = db.select().from(depositTransactions).where(eq(depositTransactions.id, id)).get();
  if (!original) return res.status(404).json({ error: { code: "not_found", message: "Deposit transaction not found." } });
  if (rejectIfDraft(res, original.contractId)) return;

  const alreadyReversed = db.select().from(depositTransactions).all().some((t) => t.reversalOfId === id);
  if (alreadyReversed) return res.status(409).json({ error: { code: "already_reversed", message: "Already reversed." } });

  const reason = req.body?.reason as string | undefined;
  if (!reason) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required." } });

  const reversal = db
    .insert(depositTransactions)
    .values({
      contractId: original.contractId,
      transactionType: "reversal",
      amountFen: -original.amountFen,
      transactionDate: todayInChina(),
      reversalOfId: id,
      reason,
      actorUserId: req.user!.id,
      approvedBy: req.user!.id,
    })
    .returning()
    .get();

  recordAudit({ actorUserId: req.user!.id, action: "deposit_transaction_reversed", entityType: "deposit_transaction", entityId: id, reason, details: { contract: contractRef(original.contractId), originalType: original.transactionType, amountFen: original.amountFen, transactionDate: original.transactionDate } });
  res.status(201).json({ reversal });
});
