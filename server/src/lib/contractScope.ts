import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contractUnits, units } from "../db/schema.js";
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
