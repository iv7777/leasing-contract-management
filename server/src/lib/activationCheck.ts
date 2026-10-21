import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { concessions, contracts, contractUnits, depositTerms, pricingStreams, pricingStreamUnits, rateSchedule } from "../db/schema.js";
import { MSG, concessionError, contractUnitError, dateOrderError, depositTermError, rateOverlapError, rateShapeError } from "./contractRules.js";
import { isRealDate } from "./validate.js";

export interface ActivationProblem {
  /** The item the problem is about (a fee name, a unit), when there is one. */
  item?: string;
  message: string;
}

/** Everything wrong with a draft that would make billing it wrong or impossible.
 * Activation is refused until the list is empty, so a contract can't go live with
 * rates that overlap, a deposit with no amount, a unit already leased elsewhere, and so on. */
export function activationProblems(contractId: number): ActivationProblem[] {
  const out: ActivationProblem[] = [];
  const add = (message: string | null, item?: string) => {
    if (message) out.push(item ? { item, message } : { message });
  };

  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) return out;

  if (!isRealDate(contract.termStart) || !isRealDate(contract.termEnd)) add("The contract's start or end date is not a valid date.");
  else add(dateOrderError(contract.termStart, contract.termEnd));
  if (contract.landlordPartyId === contract.tenantPartyId) add(MSG.sameParty);

  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  if (cUnits.length === 0) add(MSG.noUnit);
  for (const cu of cUnits) {
    add(contractUnitError(contractId, cu.unitId, cu.contractedAreaSqm, cu.effectiveStart, cu.effectiveEnd, cu.id));
  }

  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  if (streams.length === 0) add(MSG.noFees);
  const streamIds = streams.map((s) => s.id);
  const rates = streamIds.length ? db.select().from(rateSchedule).where(inArray(rateSchedule.pricingStreamId, streamIds)).all() : [];
  const streamUnits = streamIds.length ? db.select().from(pricingStreamUnits).where(inArray(pricingStreamUnits.pricingStreamId, streamIds)).all() : [];
  for (const s of streams) {
    const name = s.label?.trim() || s.feeType;
    const own = rates.filter((r) => r.pricingStreamId === s.id);
    if (own.length === 0) add(MSG.feeNoRate, name);
    for (const r of own) {
      if (!isRealDate(r.effectiveStart) || (r.effectiveEnd && !isRealDate(r.effectiveEnd))) add("A rate has a date that is not valid.", name);
      else add(rateShapeError(r), name);
      add(rateOverlapError(own, { id: r.id, effectiveStart: r.effectiveStart, effectiveEnd: r.effectiveEnd }), name);
      if (r.rateBasis === "per_sqm_per_month" && !streamUnits.some((u) => u.pricingStreamId === s.id)) add(MSG.perSqmNeedsUnits, name);
    }
  }

  for (const c of db.select().from(concessions).where(eq(concessions.contractId, contractId)).all()) {
    add(concessionError(c), "discount");
  }
  for (const d of db.select().from(depositTerms).where(eq(depositTerms.contractId, contractId)).all()) {
    add(depositTermError(d), "deposit");
  }

  // The same message twice (e.g. two rates colliding) is one problem.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.item ?? ""}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
