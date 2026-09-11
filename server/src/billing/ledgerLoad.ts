import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { charges, chargeAdjustments, receipts, receiptAllocations, depositTransactions } from "../db/schema.js";
import type { MonthlyStatementInput } from "./ledger.js";

/** Loads everything computeMonthlyStatement (and the per-charge/per-receipt
 * helpers) need for one contract, in the shape those pure functions expect. */
export function loadLedgerInputs(contractId: number): MonthlyStatementInput & {
  chargesRaw: typeof charges.$inferSelect[];
  receiptsRaw: typeof receipts.$inferSelect[];
} {
  const chargesRaw = db.select().from(charges).where(eq(charges.contractId, contractId)).all();
  const chargeIds = chargesRaw.map((c) => c.id);

  const adjustmentsRaw = chargeIds.length
    ? db.select().from(chargeAdjustments).all().filter((a) => chargeIds.includes(a.chargeId))
    : [];
  const allocationsRaw = chargeIds.length
    ? db.select().from(receiptAllocations).all().filter((a) => chargeIds.includes(a.chargeId))
    : [];
  const receiptsRaw = db.select().from(receipts).where(eq(receipts.contractId, contractId)).all();
  const depositTransactionsRaw = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contractId)).all();

  return {
    chargesRaw,
    receiptsRaw,
    charges: chargesRaw.map((c) => ({
      id: c.id,
      amountFen: c.amountFen,
      dueDate: c.dueDate,
      serviceStart: c.serviceStart,
      serviceEnd: c.serviceEnd,
      status: c.status,
    })),
    adjustments: adjustmentsRaw.map((a) => ({ chargeId: a.chargeId, amountFen: a.amountFen, createdAt: a.createdAt })),
    receipts: receiptsRaw.map((r) => ({ id: r.id, amountFen: r.amountFen, status: r.status })),
    allocations: allocationsRaw.map((a) => ({ receiptId: a.receiptId, chargeId: a.chargeId, amountFen: a.amountFen, createdAt: a.createdAt })),
    depositTransactions: depositTransactionsRaw.map((d) => ({ amountFen: d.amountFen, transactionDate: d.transactionDate })),
  };
}
