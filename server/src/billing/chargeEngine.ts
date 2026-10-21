import {
  Decimal,
  yuanToFen,
  daysBetween,
  daysInMonth,
  monthsBetween,
  lastDayOfMonth,
  type IsoDate,
} from "@lcm/shared";
import type {
  ChargeEngineInput,
  ChargeLine,
  ChargeLineSnapshotSubperiod,
  RateScheduleInput,
  ConcessionInput,
} from "./types.js";

/** Splits [periodStart, periodEnd] (inclusive) into contiguous sub-intervals
 * at every boundary date that falls strictly inside the period, so a
 * mid-period rate change or a concession that starts/ends mid-month each
 * get their own line in the calculation snapshot. */
function splitPeriod(periodStart: IsoDate, periodEnd: IsoDate, boundaries: IsoDate[]): [IsoDate, IsoDate][] {
  const cuts = Array.from(new Set(boundaries))
    .filter((b) => b > periodStart && b <= periodEnd)
    .sort();

  const result: [IsoDate, IsoDate][] = [];
  let start = periodStart;
  for (const cut of cuts) {
    result.push([start, addDays(cut, -1)]);
    start = cut;
  }
  result.push([start, periodEnd]);
  return result;
}

function addDays(date: IsoDate, delta: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function isUsageBased(method: string): boolean {
  return method === "metered" || method === "usage_fee_per_unit" || method === "usage_fee_percent";
}

function findRateAt(rates: RateScheduleInput[], streamId: number, date: IsoDate): RateScheduleInput | undefined {
  return rates.find(
    (r) => r.pricingStreamId === streamId && r.effectiveStart <= date && (!r.effectiveEnd || r.effectiveEnd >= date),
  );
}

function findConcessionAt(concessions: ConcessionInput[], streamId: number, date: IsoDate): ConcessionInput | undefined {
  return concessions.find(
    (c) =>
      (c.pricingStreamId === null || c.pricingStreamId === streamId) &&
      c.effectiveStart <= date &&
      c.effectiveEnd >= date,
  );
}

/** Compounds a percentage-escalation rate's base amount forward to the
 * given date. Rounded to 2 decimal (yuan cents) at each tier, matching how
 * a signed lease states a stepped rate table rather than carrying infinite
 * decimal precision between tiers. */
export function computeEscalatedRate(rate: RateScheduleInput, atDate: IsoDate): Decimal {
  const base = new Decimal(rate.amountOrRate);
  if (rate.calculationMethod !== "percentage_escalation") return base;

  const intervalMonths = rate.escalationIntervalMonths ?? 12;
  const monthsElapsed = Math.max(0, monthsBetween(rate.effectiveStart, atDate));
  const tiersElapsed = Math.floor(monthsElapsed / intervalMonths);
  const pct = new Decimal(rate.escalationPercentage ?? "0").dividedBy(100);

  let current = base;
  for (let i = 0; i < tiersElapsed; i++) {
    current = current.times(new Decimal(1).plus(pct)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  return current;
}

/** Preview of the escalation tiers for review at contract entry, per the
 * brief's requirement to show the resulting tiers before relying on them. */
export function previewEscalationTiers(rate: RateScheduleInput, tierCount: number) {
  const intervalMonths = rate.escalationIntervalMonths ?? 12;
  const tiers: { tier: number; effectiveFrom: IsoDate; rate: string }[] = [];
  let current = new Decimal(rate.amountOrRate);
  const pct = new Decimal(rate.escalationPercentage ?? "0").dividedBy(100);
  for (let i = 0; i < tierCount; i++) {
    const effectiveFrom = addMonthsIso(rate.effectiveStart, i * intervalMonths);
    tiers.push({ tier: i, effectiveFrom, rate: current.toFixed(2) });
    current = current.times(new Decimal(1).plus(pct)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  return tiers;
}

function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function totalAreaAt(input: ChargeEngineInput, streamId: number, date: IsoDate): Decimal {
  const unitIds = input.pricingStreamUnits.filter((psu) => psu.pricingStreamId === streamId).map((psu) => psu.contractUnitId);
  const units = input.contractUnits.filter(
    (u) => unitIds.includes(u.id) && u.effectiveStart <= date && (!u.effectiveEnd || u.effectiveEnd >= date),
  );
  return units.reduce((sum, u) => sum.plus(new Decimal(u.contractedAreaSqm)), new Decimal(0));
}

/** Generates one charge line per pricing stream for a single calendar
 * month [periodStart, periodEnd], using only approved/effective terms
 * (the caller is responsible for passing terms as of the correct contract
 * version). Handles mid-period rate changes, percentage escalation, and
 * free-rent/discount concessions by splitting into sub-periods and prorating
 * on actual calendar days; final rounding to fen happens once per charge
 * line, not per sub-period. */
export interface GenerateChargeLinesResult {
  lines: ChargeLine[];
  skippedMissingUsage: number[]; // pricingStreamIds skipped for lack of a matching usage entry
  /** Same streams as skippedMissingUsage, with the due date the charge will
   * get once a reading is entered — lets callers tell "reading is overdue to
   * be entered" from "period hasn't ended yet". */
  missingUsage: { pricingStreamId: number; dueDate: IsoDate }[];
}

export function generateChargeLines(
  input: ChargeEngineInput,
  periodStart: IsoDate,
  periodEnd: IsoDate,
): GenerateChargeLinesResult {
  const [py, pm] = periodStart.split("-").map(Number);
  const monthLength = daysInMonth(py, pm);

  const dueDate = computeDueDate(periodStart, input.billingRules);
  const meteredDueDate = computeMeteredDueDate(periodStart, input.billingRules);

  const lines: ChargeLine[] = [];
  const skippedMissingUsage: number[] = [];
  const missingUsage: { pricingStreamId: number; dueDate: IsoDate }[] = [];

  for (const stream of input.pricingStreams) {
    const streamRates = input.rateSchedule.filter((r) => r.pricingStreamId === stream.id);
    const streamConcessions = input.concessions.filter((c) => c.pricingStreamId === null || c.pricingStreamId === stream.id);

    const rateAtStart = findRateAt(streamRates, stream.id, periodStart);
    if (rateAtStart?.calculationMethod === "metered") {
      const usage = input.usageEntries.find(
        (u) => u.pricingStreamId === stream.id && u.serviceStart === periodStart && u.serviceEnd === periodEnd,
      );
      if (!usage) {
        skippedMissingUsage.push(stream.id);
        missingUsage.push({ pricingStreamId: stream.id, dueDate: meteredDueDate });
        continue;
      }

      const pricePerUnit = new Decimal(rateAtStart.amountOrRate);
      const quantity = new Decimal(usage.quantity);
      const rawAmount = pricePerUnit.times(quantity);

      const concession = findConcessionAt(streamConcessions, stream.id, periodStart);
      const afterConcession = concession
        ? rawAmount.times(new Decimal(1).minus(new Decimal(concession.discountPercentage).dividedBy(100)))
        : rawAmount;

      lines.push({
        pricingStreamId: stream.id,
        feeType: stream.feeType,
        serviceStart: periodStart,
        serviceEnd: periodEnd,
        dueDate: meteredDueDate,
        amountFen: yuanToFen(afterConcession),
        snapshot: {
          subperiods: [
            {
              start: periodStart,
              end: periodEnd,
              rateScheduleId: rateAtStart.id,
              calculationMethod: rateAtStart.calculationMethod,
              rateBasis: rateAtStart.rateBasis,
              baseRate: rateAtStart.amountOrRate,
              effectiveRate: pricePerUnit.toFixed(4),
              areaSqm: null,
              daysInSubperiod: daysBetween(periodStart, periodEnd) + 1,
              daysInMonth: monthLength,
              monthlyEquivalent: rawAmount.toFixed(4),
              proratedAmount: rawAmount.toFixed(4),
              concessionDiscountPercentage: concession?.discountPercentage ?? null,
              concessionReason: concession?.reason ?? null,
              amountAfterConcession: afterConcession.toFixed(4),
              quantity: quantity.toFixed(4),
              unit: rateAtStart.unit,
            },
          ],
          totalBeforeRounding: afterConcession.toFixed(4),
        },
      });
      continue;
    }

    // A service fee on a metered item's usage (0.10 per kWh, or 10% of the usage
    // charge) is billed as its own line from the same reading. The reading is the
    // linked item's, so a missing one is reported there, not twice.
    if (rateAtStart?.calculationMethod === "usage_fee_per_unit" || rateAtStart?.calculationMethod === "usage_fee_percent") {
      const linkedRate = rateAtStart.linkedStreamId
        ? findRateAt(input.rateSchedule.filter((r) => r.pricingStreamId === rateAtStart.linkedStreamId), rateAtStart.linkedStreamId, periodStart)
        : undefined;
      if (!rateAtStart.linkedStreamId) {
        throw new Error(`Usage service fee (rate schedule ${rateAtStart.id}) is not linked to a metered item`);
      }
      // The followed item has no price yet (or any more) on this date: nothing to follow, so no fee line.
      if (!linkedRate) continue;
      if (linkedRate.calculationMethod !== "metered") {
        throw new Error(`Usage service fee (rate schedule ${rateAtStart.id}) is linked to an item that is not metered`);
      }
      const usage = input.usageEntries.find(
        (u) => u.pricingStreamId === rateAtStart.linkedStreamId && u.serviceStart === periodStart && u.serviceEnd === periodEnd,
      );
      if (!usage) continue;

      const quantity = new Decimal(usage.quantity);
      const value = new Decimal(rateAtStart.amountOrRate);
      // Per unit: the fee per kWh/ton times the usage. Percent: a share of the usage charge before
      // any concession, so a contract-wide discount is applied once (to this fee) and not twice.
      const rawAmount =
        rateAtStart.calculationMethod === "usage_fee_per_unit"
          ? value.times(quantity)
          : new Decimal(linkedRate.amountOrRate).times(quantity).times(value).dividedBy(100);

      const concession = findConcessionAt(streamConcessions, stream.id, periodStart);
      const afterConcession = concession
        ? rawAmount.times(new Decimal(1).minus(new Decimal(concession.discountPercentage).dividedBy(100)))
        : rawAmount;

      lines.push({
        pricingStreamId: stream.id,
        feeType: stream.feeType,
        serviceStart: periodStart,
        serviceEnd: periodEnd,
        dueDate: meteredDueDate,
        amountFen: yuanToFen(afterConcession),
        snapshot: {
          subperiods: [
            {
              start: periodStart,
              end: periodEnd,
              rateScheduleId: rateAtStart.id,
              calculationMethod: rateAtStart.calculationMethod,
              rateBasis: rateAtStart.rateBasis,
              baseRate: rateAtStart.amountOrRate,
              effectiveRate: value.toFixed(4),
              areaSqm: null,
              daysInSubperiod: daysBetween(periodStart, periodEnd) + 1,
              daysInMonth: monthLength,
              monthlyEquivalent: rawAmount.toFixed(4),
              proratedAmount: rawAmount.toFixed(4),
              concessionDiscountPercentage: concession?.discountPercentage ?? null,
              concessionReason: concession?.reason ?? null,
              amountAfterConcession: afterConcession.toFixed(4),
              quantity: quantity.toFixed(4),
              unit: linkedRate.unit,
            },
          ],
          totalBeforeRounding: afterConcession.toFixed(4),
        },
      });
      continue;
    }

    // Usage-based items (a metered price, a service fee on usage) are billed a whole month
    // at a time from the reading, at the price in force on the month's first day. A price
    // that only starts later in the month therefore bills nothing for that month; it must
    // never fall into the day-prorated path below.
    if (!rateAtStart && streamRates.length > 0 && streamRates.every((r) => isUsageBased(r.calculationMethod))) continue;

    const boundaries = [
      ...streamRates.map((r) => r.effectiveStart),
      ...streamRates.filter((r) => r.effectiveEnd).map((r) => addDays(r.effectiveEnd!, 1)),
      ...streamConcessions.map((c) => c.effectiveStart),
      ...streamConcessions.map((c) => addDays(c.effectiveEnd, 1)),
    ];

    const subperiods = splitPeriod(periodStart, periodEnd, boundaries);
    const snapshotSubs: ChargeLineSnapshotSubperiod[] = [];
    let total = new Decimal(0);

    for (const [subStart, subEnd] of subperiods) {
      const rate = findRateAt(streamRates, stream.id, subStart);
      if (!rate) continue; // no effective term for this window — nothing charged
      if (isUsageBased(rate.calculationMethod)) continue; // billed from readings, not by the day

      const effectiveRate = computeEscalatedRate(rate, subStart);
      const areaSqm = rate.rateBasis === "per_sqm_per_month" ? totalAreaAt(input, stream.id, subStart) : null;

      let monthlyEquivalent: Decimal;
      switch (rate.rateBasis) {
        case "per_month":
          monthlyEquivalent = effectiveRate;
          break;
        case "per_quarter":
          monthlyEquivalent = effectiveRate.dividedBy(3);
          break;
        case "per_year":
          monthlyEquivalent = effectiveRate.dividedBy(12);
          break;
        case "per_sqm_per_month":
          monthlyEquivalent = effectiveRate.times(areaSqm!);
          break;
        case "per_unit":
        case "percent_of_usage":
          // These bases only apply to metered prices and usage service fees, which are
          // handled in their own branches above and never reach this sub-period loop.
          throw new Error(`Unexpected ${rate.rateBasis} rate basis outside the usage branches (rate schedule ${rate.id})`);
      }

      const daysInSub = daysBetween(subStart, subEnd) + 1;
      const prorated = monthlyEquivalent.times(daysInSub).dividedBy(monthLength);

      const concession = findConcessionAt(streamConcessions, stream.id, subStart);
      const afterConcession = concession
        ? prorated.times(new Decimal(1).minus(new Decimal(concession.discountPercentage).dividedBy(100)))
        : prorated;

      total = total.plus(afterConcession);

      snapshotSubs.push({
        start: subStart,
        end: subEnd,
        rateScheduleId: rate.id,
        calculationMethod: rate.calculationMethod,
        rateBasis: rate.rateBasis,
        baseRate: rate.amountOrRate,
        effectiveRate: effectiveRate.toFixed(4),
        areaSqm: areaSqm ? areaSqm.toFixed(2) : null,
        daysInSubperiod: daysInSub,
        daysInMonth: monthLength,
        monthlyEquivalent: monthlyEquivalent.toFixed(4),
        proratedAmount: prorated.toFixed(4),
        concessionDiscountPercentage: concession?.discountPercentage ?? null,
        concessionReason: concession?.reason ?? null,
        amountAfterConcession: afterConcession.toFixed(4),
      });
    }

    if (snapshotSubs.length === 0) continue;

    lines.push({
      pricingStreamId: stream.id,
      feeType: stream.feeType,
      serviceStart: periodStart,
      serviceEnd: periodEnd,
      dueDate,
      amountFen: yuanToFen(total),
      snapshot: { subperiods: snapshotSubs, totalBeforeRounding: total.toFixed(4) },
    });
  }

  return { lines, skippedMissingUsage, missingUsage };
}

/** Metered charges (electricity, water) can only be computed after the
 * usage month ends, so they are billed in arrears: due on the contract's due
 * day in the month after the usage month — or later, if the contract's own
 * offset already puts rent that far out. Due on the rent schedule instead,
 * a March meter reading entered in April would be born overdue. */
export function computeMeteredDueDate(periodStart: IsoDate, billingRules: { dueDay: number; dueMonthOffset: number }): IsoDate {
  return computeDueDate(periodStart, { dueDay: billingRules.dueDay, dueMonthOffset: Math.max(1, billingRules.dueMonthOffset) });
}

/** "25th of the prior month" == dueDay 25, dueMonthOffset -1 from the
 * service period's start month. Falls back to the last day of the target
 * month when dueDay doesn't exist there (e.g. day 31 in February). */
export function computeDueDate(periodStart: IsoDate, billingRules: { dueDay: number; dueMonthOffset: number }): IsoDate {
  const [y, m] = periodStart.split("-").map(Number);
  const total = y * 12 + (m - 1) + billingRules.dueMonthOffset;
  const targetYear = Math.floor(total / 12);
  const targetMonth1to12 = (total % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth1to12);
  const day = Math.min(billingRules.dueDay, maxDay);
  if (billingRules.dueDay > maxDay) {
    return lastDayOfMonth(targetYear, targetMonth1to12);
  }
  return `${targetYear}-${String(targetMonth1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
