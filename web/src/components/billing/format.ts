export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Server returns a stream's own label, or the raw fee type when it has none. */
export function streamName(t: (key: string) => string, label: string, feeType: string): string {
  return label === feeType ? t(`contracts.${camel(feeType)}`) : label;
}

/** Reasons the system writes itself are stored in English; show them in the viewer's language. Anything a person
 * typed is shown as it is. */
const SYSTEM_REASONS: Record<string, string> = {
  "Opening balance: deposit held per accountant": "depositHeld",
  "Opening balance adjusted": "adjusted",
  "Opening balance undone": "undone",
  "Opening balance reversed": "reversed",
  Removed: "removed",
  "Meter reading corrected": "readingCorrected",
  "Meter reading removed": "readingRemoved",
};
export function systemReasonLabel(t: (key: string) => string, reason: string | null | undefined): string {
  if (!reason) return "";
  const key = SYSTEM_REASONS[reason];
  return key ? t(`systemReasons.${key}`) : reason;
}

/** Payment methods are stored as the English names above; show them in the
 * viewer's language. Anything else (older or free-typed values) is shown as is. */
export function paymentMethodLabel(t: (key: string) => string, method: string): string {
  if (method === "Opening balance") return t("billing.methods.openingBalance");
  return (PAYMENT_METHODS as readonly string[]).includes(method) ? t(`billing.methods.${camel(method.toLowerCase().replace(/ /g, "_"))}`) : method;
}

/** What a document is called in lists: the name its uploader gave it, or else its type. */
export function docDisplayName(t: (key: string) => string, d: { name?: string | null; docType: string }): string {
  return d.name?.trim() ? d.name.trim() : docTypeLabel(t, d.docType);
}

/** Document types the app itself offers; any other value is the user's own wording. */
export function docTypeLabel(t: (key: string) => string, docType: string): string {
  if (docType === "signed_lease") return t("contracts.signedLease");
  if (docType === "signed_supplement") return t("contracts.signedSupplement");
  if (docType === "other") return t("contracts.otherDocumentType");
  return docType;
}

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "WeChat Pay", "Alipay", "Cheque", "Other"] as const;

/** "3h 12m" / "45m": how long is left until an ISO time, or "" once it has passed. */
export function timeLeft(untilIso: string | null | undefined, now: number = Date.now()): string {
  if (!untilIso) return "";
  const ms = new Date(untilIso).getTime() - now;
  if (!(ms > 0)) return "";
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
}

/** Metered items are priced per unit from a reading ("metered") or take the amount typed with the reading ("metered_amount"). */
export function isMeteredMethod(method: string | null | undefined): boolean {
  return method === "metered" || method === "metered_amount";
}

/** The price per unit an entered amount works out to, or null when it can't be told. */
export function impliedPrice(quantity: number | null | undefined, amountYuan: number | null | undefined): number | null {
  if (!quantity || quantity <= 0 || amountYuan === null || amountYuan === undefined) return null;
  return amountYuan / quantity;
}

/** How far a price is from the one before it (0.4 = 40% higher, -0.4 = 40% lower); null when there is nothing to compare. */
export function priceDeviation(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before <= 0) return null;
  return (now - before) / before;
}

/** Further than this from last month's price is worth a second look (a slipped decimal, a wrong kWh). */
export const PRICE_JUMP = 0.3;

/** "2026-11" for a whole calendar month, otherwise "2026-11-01 → 2026-11-15". */
export function periodLabel(start: string, end: string): string {
  return start.endsWith("-01") && end.slice(0, 7) === start.slice(0, 7) && end >= `${start.slice(0, 7)}-28` ? start.slice(0, 7) : `${start} → ${end}`;
}
