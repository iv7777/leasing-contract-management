import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, contractUnits, units } from "../db/schema.js";
import { canAccessAllProperties, type AuthedUser } from "../middleware/auth.js";

/** A multi-property agreement requires assignment to every covered
 * property, not just one (brief §5). Applies to detail, search, reports,
 * and exports alike — this is the single place that answers "which
 * properties does this contract touch." */
export function getContractPropertyIds(contractId: number): number[] {
  const rows = db
    .select({ propertyId: units.propertyId })
    .from(contractUnits)
    .innerJoin(units, eq(contractUnits.unitId, units.id))
    .where(eq(contractUnits.contractId, contractId))
    .all();
  return Array.from(new Set(rows.map((r) => r.propertyId)));
}

export function canAccessContract(user: AuthedUser, contractId: number): boolean {
  const propertyIds = getContractPropertyIds(contractId);
  if (propertyIds.length === 0) return user.role === "admin" || user.role === "manager"; // no units assigned yet
  return canAccessAllProperties(user, propertyIds);
}

/** A draft contract is paperwork only: nothing is billed, collected or metered
 * until it is activated. Money and meter-reading endpoints call this after
 * their access check; it sends the 409 and returns true when the contract is
 * still a draft. Expired and terminated contracts are deliberately not blocked
 * (arrears are still collected and deposits settled after a lease ends). */
export function rejectIfDraft(
  res: Response,
  contractId: number,
  message = "This contract is still a draft. Activate it before recording payments, receipts, charges, deposits or meter readings.",
): boolean {
  const row = db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contractId)).get();
  if (row?.status !== "draft") return false;
  res.status(409).json({
    error: { code: "contract_not_active", message },
  });
  return true;
}
