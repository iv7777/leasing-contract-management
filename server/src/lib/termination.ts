import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { amendments, contracts } from "../db/schema.js";

type ContractRow = typeof contracts.$inferSelect;

/** The earliest effective date of an approved early-termination amendment that has
 * not taken effect yet, or null. Such a contract is still "active" until that date,
 * but nothing after it may be billed. */
export function pendingTerminationDate(contractId: number): string | null {
  const approved = db.select().from(amendments).where(and(eq(amendments.contractId, contractId), eq(amendments.status, "approved"))).all();
  let earliest: string | null = null;
  for (const a of approved) {
    try {
      const status = (JSON.parse(a.changesJson) as { contract?: { status?: string } }).contract?.status;
      if (status === "terminated" && (earliest === null || a.effectiveDate < earliest)) earliest = a.effectiveDate;
    } catch {
      // an unreadable amendment can't shorten anything
    }
  }
  return earliest;
}

/** The last day the contract can be billed: its term end, or an earlier approved
 * termination date while the contract is still active. */
export function lastBillableDay(contract: ContractRow): string {
  if (contract.status !== "active") return contract.termEnd;
  const pending = pendingTerminationDate(contract.id);
  return pending !== null && pending < contract.termEnd ? pending : contract.termEnd;
}
