import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts } from "../db/schema.js";
import { getContractPropertyIds } from "../lib/contractScope.js";
import { computeChargeBalance } from "./ledger.js";
import { loadLedgerInputs } from "./ledgerLoad.js";

export interface ContractOverdue {
  contractId: number;
  overdueFen: number;
  overdueCount: number;
  maxDaysOverdue: number;
}

/** What one contract owes past its grace period, from the same balance
 * calculation the Dashboard and Reminders use — so a dot, a tag and a
 * reminder can never disagree. Null when nothing is overdue. */
export function loadContractOverdue(contractId: number, today: string): ContractOverdue | null {
  const ledger = loadLedgerInputs(contractId);
  let overdueFen = 0;
  let overdueCount = 0;
  let maxDaysOverdue = 0;
  for (const c of ledger.charges) {
    if (c.status !== "posted") continue;
    const b = computeChargeBalance(c, ledger.adjustments, ledger.allocations, today, ledger.overdueGraceDays);
    if (!b.isOverdue || b.balanceFen <= 0) continue;
    overdueFen += b.balanceFen;
    overdueCount += 1;
    maxDaysOverdue = Math.max(maxDaysOverdue, b.daysOverdue);
  }
  return overdueCount > 0 ? { contractId, overdueFen, overdueCount, maxDaysOverdue } : null;
}

export interface OverdueSummary {
  contracts: ContractOverdue[];
  /** Contracts with an overdue balance per property (a multi-property
   * contract counts once for each property it covers). */
  properties: { propertyId: number; contractCount: number; overdueFen: number }[];
}

export function buildOverdueSummary(contractIds: number[], today: string): OverdueSummary {
  const rows: ContractOverdue[] = [];
  const byProperty = new Map<number, { contractCount: number; overdueFen: number }>();
  for (const id of contractIds) {
    const o = loadContractOverdue(id, today);
    if (!o) continue;
    rows.push(o);
    for (const propertyId of getContractPropertyIds(id)) {
      const p = byProperty.get(propertyId) ?? { contractCount: 0, overdueFen: 0 };
      p.contractCount += 1;
      p.overdueFen += o.overdueFen;
      byProperty.set(propertyId, p);
    }
  }
  return { contracts: rows, properties: Array.from(byProperty, ([propertyId, v]) => ({ propertyId, ...v })) };
}

export function activeContractIds(): number[] {
  return db.select({ id: contracts.id }).from(contracts).where(eq(contracts.status, "active")).all().map((r) => r.id);
}
