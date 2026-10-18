import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { depositTerms, depositTransactions } from "../db/schema.js";
import { computeDepositBalance } from "./ledger.js";
import { computeDepositStatus, type DepositStatus } from "./depositStatus.js";

/** Loads a contract's deposit terms and ledger and returns its current
 * status — the single path every screen and reminder uses. */
export function loadDepositStatus(contractId: number, asOf: string): DepositStatus {
  const terms = db.select().from(depositTerms).where(eq(depositTerms.contractId, contractId)).all();
  const txns = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contractId)).all();
  const heldFen = computeDepositBalance(txns.map((t) => ({ amountFen: t.amountFen, transactionDate: t.transactionDate })), asOf);
  return computeDepositStatus(
    terms.map((t) => ({
      id: t.id,
      effectiveStart: t.effectiveStart,
      requirementType: t.requirementType,
      fixedAmountFen: t.fixedAmountFen,
      formulaBasis: t.formulaBasis,
      waiverMet: t.waiverMet,
      dueDate: t.dueDate,
    })),
    heldFen,
    asOf,
  );
}
