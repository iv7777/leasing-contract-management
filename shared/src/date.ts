/**
 * Lease dates, service periods, and due dates are China business dates.
 * We store plain ISO calendar dates (YYYY-MM-DD, no time/zone) for anything
 * that is a "date" in the lease sense (term dates, due dates, service
 * periods) so a remote (US) viewer never sees a due date shift because of
 * their local timezone. Timestamps for audit/created/updated use ISO 8601
 * UTC instants and are displayed converted to a stated timezone in the UI.
 */

export const CHINA_TIMEZONE = "Asia/Shanghai";

export type IsoDate = string; // YYYY-MM-DD
export type IsoInstant = string; // full ISO 8601 UTC instant

export function todayInChina(): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export function nowIso(): IsoInstant {
  return new Date().toISOString();
}

export function formatDate(date: IsoDate, locale: "en" | "zh" = "en"): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

export function formatInstant(instant: IsoInstant, locale: "en" | "zh" = "en", timeZone = CHINA_TIMEZONE): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}

/** Days between two ISO calendar dates (b - a), for proration/overdue-age math. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}
