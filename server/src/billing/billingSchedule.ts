import { addMonths, lastDayOfMonth, type IsoDate } from "@lcm/shared";

// Pure month-selection rules for automatic billing, kept free of database
// imports so they are unit-tested directly (billingSchedule.test.ts).

export interface BillingPeriod {
  periodStart: IsoDate;
  periodEnd: IsoDate;
}

export function monthStartOf(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function monthEndOf(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number);
  return lastDayOfMonth(y, m);
}

/** The calendar months that could hold a charge due on or before `cutoff`,
 * from the lease's first month to its last. Each month is only a candidate —
 * the caller still compares every generated line's own due date to the
 * cutoff, because rent, metered fees and short-month fallbacks each land on
 * different dates. Months billed in advance (negative due-month offset)
 * extend past the cutoff month, so we look that far ahead. */
export function periodsToConsider(
  termStart: IsoDate,
  termEnd: IsoDate,
  rules: { dueMonthOffset: number },
  cutoff: IsoDate,
): BillingPeriod[] {
  const first = monthStartOf(termStart);
  const lookAheadMonths = Math.max(0, -rules.dueMonthOffset);
  const last = addMonths(monthStartOf(cutoff), lookAheadMonths);

  const periods: BillingPeriod[] = [];
  for (let m = first; m <= last && m <= termEnd; m = addMonths(m, 1)) {
    periods.push({ periodStart: m, periodEnd: monthEndOf(m) });
  }
  return periods;
}
