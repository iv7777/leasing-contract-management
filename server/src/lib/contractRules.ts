import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, contractUnits, units } from "../db/schema.js";

/** Business-sense checks shared by the draft editors, the amendments and
 * activation, each returning an English message (translated in the web app) or
 * null. They are about whether the numbers make sense together, not about
 * the shape of the request (that is zod's job). */

export const MSG = {
  endBeforeStart: "The end date must be on or after the start date.",
  sameParty: "The landlord and the tenant must be different parties.",
  duplicateReference: "A contract with this reference number already exists.",
  areaTooLarge: "The contracted area can't be more than the unit's rentable area.",
  areaZero: "The contracted area must be more than zero.",
  unitTwice: "This unit is already on this contract for an overlapping period.",
  rateOverlap: "This rate overlaps another rate of the same item.",
  basisMismatch: "That rate basis doesn't fit the calculation method.",
  escalationFields: "A percentage escalation needs a base, a percentage and an interval in months.",
  meteredUnit: "A metered price needs the unit it is priced per (for example kWh).",
  discountRange: "A discount must be more than 0 and no more than 100 percent.",
  depositFixed: "A fixed deposit needs an amount.",
  depositFormula: "A formula deposit needs the formula basis.",
  perSqmNeedsUnits: "A per-square-metre item must be linked to at least one unit.",
  noUnit: "The contract has no units.",
  noFees: "The contract has no fees (pricing items).",
  feeNoRate: "A fee has no rate.",
} as const;

export function dateOrderError(start: string, end: string | null | undefined): string | null {
  return end && end < start ? MSG.endBeforeStart : null;
}

const PERIODIC_BASES = ["per_month", "per_quarter", "per_year"];

export interface RateShape {
  calculationMethod: string;
  rateBasis: string;
  amountOrRate: string;
  escalationBase?: string | null;
  escalationPercentage?: string | null;
  escalationIntervalMonths?: number | null;
  unit?: string | null;
  effectiveStart: string;
  effectiveEnd?: string | null;
}

/** Whether a rate is internally consistent: dates in order, a basis that fits the
 * method, and the extra fields its method needs. */
export function rateShapeError(r: RateShape): string | null {
  const dateErr = dateOrderError(r.effectiveStart, r.effectiveEnd);
  if (dateErr) return dateErr;
  switch (r.calculationMethod) {
    case "flat":
      return PERIODIC_BASES.includes(r.rateBasis) ? null : MSG.basisMismatch;
    case "per_sqm":
      return r.rateBasis === "per_sqm_per_month" ? null : MSG.basisMismatch;
    case "percentage_escalation":
      if (![...PERIODIC_BASES, "per_sqm_per_month"].includes(r.rateBasis)) return MSG.basisMismatch;
      if (!r.escalationBase || !r.escalationPercentage || !r.escalationIntervalMonths || r.escalationIntervalMonths < 1) return MSG.escalationFields;
      return null;
    case "metered":
      if (r.rateBasis !== "per_unit" && r.rateBasis !== "per_month") return MSG.basisMismatch;
      return r.unit && r.unit.trim() ? null : MSG.meteredUnit;
    default:
      return null; // usage service fees are checked by rateRuleError
  }
}

/** Whether `candidate` collides with any of the other rates of the same item. */
export function rateOverlapError(others: { id?: number; effectiveStart: string; effectiveEnd?: string | null }[], candidate: { id?: number; effectiveStart: string; effectiveEnd?: string | null }): string | null {
  for (const o of others) {
    if (candidate.id !== undefined && o.id === candidate.id) continue;
    const aEnd = candidate.effectiveEnd ?? "9999-12-31";
    const bEnd = o.effectiveEnd ?? "9999-12-31";
    if (candidate.effectiveStart <= bEnd && o.effectiveStart <= aEnd) return MSG.rateOverlap;
  }
  return null;
}

export function concessionError(c: { discountPercentage: string; effectiveStart: string; effectiveEnd: string }): string | null {
  const pct = Number(c.discountPercentage);
  if (!(pct > 0 && pct <= 100)) return MSG.discountRange;
  return dateOrderError(c.effectiveStart, c.effectiveEnd);
}

export function depositTermError(d: { requirementType: string; fixedAmountFen?: number | null; formulaBasis?: string | null }): string | null {
  if (d.requirementType === "fixed" && (d.fixedAmountFen === null || d.fixedAmountFen === undefined)) return MSG.depositFixed;
  if (d.requirementType === "formula" && !(d.formulaBasis && d.formulaBasis.trim())) return MSG.depositFormula;
  return null;
}

/** A unit on a contract: positive area that fits the unit, dates in order, and not already
 * on this contract or another draft/active contract for an overlapping period. */
export function contractUnitError(
  contractId: number,
  unitId: number,
  contractedAreaSqm: string,
  effectiveStart: string,
  effectiveEnd: string | null | undefined,
  excludeContractUnitId?: number,
): string | null {
  const dateErr = dateOrderError(effectiveStart, effectiveEnd);
  if (dateErr) return dateErr;
  const area = Number(contractedAreaSqm);
  if (!(area > 0)) return MSG.areaZero;
  const unit = db.select().from(units).where(eq(units.id, unitId)).get();
  if (unit && area > Number(unit.rentableAreaSqm)) return MSG.areaTooLarge;

  const rows = db
    .select({ cu: contractUnits, c: contracts })
    .from(contractUnits)
    .innerJoin(contracts, eq(contractUnits.contractId, contracts.id))
    .where(and(eq(contractUnits.unitId, unitId), inArray(contracts.status, ["draft", "active"])))
    .all();
  for (const { cu, c } of rows) {
    if (excludeContractUnitId !== undefined && cu.id === excludeContractUnitId) continue;
    const aEnd = effectiveEnd ?? "9999-12-31";
    const bEnd = cu.effectiveEnd ?? "9999-12-31";
    if (effectiveStart <= bEnd && cu.effectiveStart <= aEnd) {
      return c.id === contractId ? MSG.unitTwice : `This unit is already on contract ${c.referenceNumber} for an overlapping period.`;
    }
  }
  return null;
}

export function referenceTaken(referenceNumber: string, exceptContractId?: number): boolean {
  const q = db.select({ id: contracts.id }).from(contracts).where(eq(contracts.referenceNumber, referenceNumber)).all();
  return q.some((r) => r.id !== exceptContractId);
}
