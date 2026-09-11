import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { depositTransactions, receipts, receiptAllocations, charges } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { computeDepositBalance, validateAllocation } from "../billing/ledger.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
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
  res.json({ transactions: rows, balanceFen });
});

const receiptTxnSchema = z.object({
  transactionType: z.literal("receipt"),
  amountFen: z.number().positive(),
  transactionDate: z.string(),
  receiptId: z.number().optional(),
  reason: z.string().min(1),
});

/** Admin-only per brief §6/§8: deposit deductions, refunds, and transfers to
 * rent require Admin approval and linked entries, without double-counting
 * the money. A transfer_to_rent creates a synthetic receipt so the same
 * allocation machinery (and its over-allocation guard) applies to it. */
const adminTxnSchema = z.object({
  transactionType: z.enum(["refund", "deduction"]),
  amountFen: z.number().positive(),
  transactionDate: z.string(),
  reason: z.string().min(1),
});

const transferSchema = z.object({
  transactionType: z.literal("transfer_to_rent"),
  amountFen: z.number().positive(),
  transactionDate: z.string(),
  chargeId: z.number(),
  reason: z.string().min(1),
});

depositTransactionsRouter.post("/contracts/:contractId/deposit-transactions", requireRole("admin", "manager", "collector"), (req, res) => {
  const contractId = Number(req.params.contractId);
  if (!ensureContractAccess(req, res, contractId)) return;

  const type = req.body?.transactionType;

  if (type === "receipt") {
    const parsed = receiptTxnSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Invalid deposit receipt payload." } });
    const inserted = db
      .insert(depositTransactions)
      .values({ contractId, transactionType: "receipt", amountFen: parsed.data.amountFen, transactionDate: parsed.data.transactionDate, receiptId: parsed.data.receiptId ?? null, reason: parsed.data.reason, actorUserId: req.user!.id })
      .returning()
      .get();
    recordAudit({ actorUserId: req.user!.id, action: "deposit_received", entityType: "deposit_transaction", entityId: inserted.id, details: { amountFen: inserted.amountFen } });
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
      return res.status(409).json({ error: { code: "insufficient_deposit", message: `Only ${heldFen} fen is held; cannot ${type} ${parsed.data.amountFen}.` } });
    }

    const inserted = db
      .insert(depositTransactions)
      .values({ contractId, transactionType: parsed.data.transactionType, amountFen: -parsed.data.amountFen, transactionDate: parsed.data.transactionDate, reason: parsed.data.reason, actorUserId: req.user!.id, approvedBy: req.user!.id })
      .returning()
      .get();
    recordAudit({ actorUserId: req.user!.id, action: `deposit_${type}`, entityType: "deposit_transaction", entityId: inserted.id, reason: parsed.data.reason, details: { amountFen: parsed.data.amountFen } });
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
      return res.status(409).json({ error: { code: "insufficient_deposit", message: `Only ${heldFen} fen is held; cannot transfer ${parsed.data.amountFen}.` } });
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

    recordAudit({ actorUserId: req.user!.id, action: "deposit_transferred_to_rent", entityType: "deposit_transaction", entityId: inserted.id, details: { amountFen: parsed.data.amountFen, chargeId: charge.id } });
    return res.status(201).json({ transaction: inserted });
  }

  res.status(400).json({ error: { code: "invalid_input", message: "Unknown transactionType." } });
});

depositTransactionsRouter.post("/deposit-transactions/:id/reverse", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const original = db.select().from(depositTransactions).where(eq(depositTransactions.id, id)).get();
  if (!original) return res.status(404).json({ error: { code: "not_found", message: "Deposit transaction not found." } });

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

  recordAudit({ actorUserId: req.user!.id, action: "deposit_transaction_reversed", entityType: "deposit_transaction", entityId: id, reason });
  res.status(201).json({ reversal });
});
