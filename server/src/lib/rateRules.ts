import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { pricingStreams, rateSchedule } from "../db/schema.js";

export interface RateRuleInput {
  calculationMethod: string;
  rateBasis: string;
  amountOrRate: string;
  linkedStreamId?: number | null;
  unit?: string | null;
}

/** Which method/basis/link combinations make sense, so a rate that can never be
 * billed is refused when it is entered rather than failing at billing time.
 * Returns a message, or null when the rate is acceptable. */
export function rateRuleError(rate: RateRuleInput, contractId: number, ownStreamId: number | null): string | null {
  const usageFee = rate.calculationMethod === "usage_fee_per_unit" || rate.calculationMethod === "usage_fee_percent";

  if (rate.calculationMethod !== "metered" && rate.calculationMethod !== "metered_amount" && !usageFee && (rate.rateBasis === "per_unit" || rate.rateBasis === "percent_of_usage")) {
    return "A per-unit basis only applies to a metered price or a usage service fee. Use \"Usage service fee\" for a fee on top of metered usage.";
  }
  if (!usageFee) {
    return rate.linkedStreamId ? "Only a usage service fee can be linked to a metered item." : null;
  }

  if (rate.calculationMethod === "usage_fee_per_unit" && rate.rateBasis !== "per_unit") return "A per-unit service fee uses the \"per unit\" basis.";
  if (rate.calculationMethod === "usage_fee_percent" && rate.rateBasis !== "percent_of_usage") return "A percentage service fee uses the \"% of usage charge\" basis.";
  if (rate.calculationMethod === "usage_fee_percent" && Number(rate.amountOrRate) > 100) return "A percentage can't be more than 100.";

  if (!rate.linkedStreamId) return "Choose the metered item this service fee applies to.";
  if (rate.linkedStreamId === ownStreamId) return "A service fee can't be linked to itself.";
  const linked = db.select().from(pricingStreams).where(eq(pricingStreams.id, rate.linkedStreamId)).get();
  if (!linked || linked.contractId !== contractId) return "The linked item does not belong to this contract.";
  const linkedIsMetered = db.select().from(rateSchedule).where(eq(rateSchedule.pricingStreamId, linked.id)).all().some((r) => r.calculationMethod === "metered" || r.calculationMethod === "metered_amount");
  if (!linkedIsMetered) return "A service fee can only follow a metered (usage-based) item.";
  return null;
}
