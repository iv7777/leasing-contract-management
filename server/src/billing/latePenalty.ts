import { Decimal } from "@lcm/shared";

export interface LatePenaltyRules {
  enabled: boolean;
  dailyRatePermille: string | null; // e.g. "0.5" = 0.05%/day
  capFen: number | null;
}

/** Deliberately simple per brief §6: one flat daily rate against the
 * outstanding balance, an explicit start (the charge's own due date — a
 * penalty never accrues before something is actually overdue), and an
 * optional hard cap. No compounding, no per-contract rule engine. */
export function computeLatePenalty(balanceFen: number, daysOverdue: number, rules: LatePenaltyRules): number {
  if (!rules.enabled || balanceFen <= 0 || daysOverdue <= 0 || !rules.dailyRatePermille) return 0;

  const dailyRate = new Decimal(rules.dailyRatePermille).dividedBy(1000);
  const raw = new Decimal(balanceFen).times(dailyRate).times(daysOverdue);
  const capped = rules.capFen !== null ? Decimal.min(raw, rules.capFen) : raw;
  return capped.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}
