import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, contractUnits, units } from "../db/schema.js";
import { computeChargeBalance, computeDepositBalance } from "../billing/ledger.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { todayInChina } from "@lcm/shared";

/** Archiving hides a record from the default lists; it must never hide
 * something still in use. "Live" means a contract still being set up or in
 * force (draft / active); ended contracts (expired / terminated) don't count. */
const LIVE: ("draft" | "active")[] = ["draft", "active"];

export interface LiveContractRef {
  id: number;
  referenceNumber: string;
  status: string;
}

const liveColumns = { id: contracts.id, referenceNumber: contracts.referenceNumber, status: contracts.status };

export function liveContractsForUnit(unitId: number): LiveContractRef[] {
  return db
    .selectDistinct(liveColumns)
    .from(contractUnits)
    .innerJoin(contracts, eq(contractUnits.contractId, contracts.id))
    .where(and(eq(contractUnits.unitId, unitId), inArray(contracts.status, LIVE)))
    .all();
}

export function liveContractsForProperty(propertyId: number): LiveContractRef[] {
  return db
    .selectDistinct(liveColumns)
    .from(contractUnits)
    .innerJoin(units, eq(contractUnits.unitId, units.id))
    .innerJoin(contracts, eq(contractUnits.contractId, contracts.id))
    .where(and(eq(units.propertyId, propertyId), inArray(contracts.status, LIVE)))
    .all();
}

export function liveContractsForParty(partyId: number): LiveContractRef[] {
  return db
    .select(liveColumns)
    .from(contracts)
    .where(and(or(eq(contracts.landlordPartyId, partyId), eq(contracts.tenantPartyId, partyId)), inArray(contracts.status, LIVE)))
    .all();
}

/** Money still open on a contract: unpaid balance on posted charges (due or
 * not) and a deposit still held. Both must be settled before it is archived,
 * or the arrears / the tenant's deposit would drop out of sight. */
export function contractOutstanding(contractId: number): { unpaidFen: number; depositHeldFen: number } {
  const ledger = loadLedgerInputs(contractId);
  const today = todayInChina();
  let unpaidFen = 0;
  for (const c of ledger.charges) {
    if (c.status !== "posted") continue;
    const b = computeChargeBalance(c, ledger.adjustments, ledger.allocations, today, ledger.overdueGraceDays);
    if (b.balanceFen > 0) unpaidFen += b.balanceFen;
  }
  const depositHeldFen = Math.max(0, computeDepositBalance(ledger.depositTransactions, "9999-12-31"));
  return { unpaidFen, depositHeldFen };
}

/** "A-101 (draft), E2E-001 (active)" — for the 409 message. */
export function describeRefs(refs: LiveContractRef[]): string {
  return refs.map((r) => `${r.referenceNumber} (${r.status})`).join(", ");
}
