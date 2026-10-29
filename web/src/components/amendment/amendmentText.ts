import type { TFunction } from "i18next";
import { camel, docDisplayName, streamName, yuan } from "../billing/format";

/** One thing an amendment changes, as the server describes it (see server/src/lib/amendmentSummary.ts). */
export interface RateValue {
  calculationMethod: string;
  amountOrRate: string;
  rateBasis: string;
  unit?: string | null;
  escalationPercentage?: string | null;
  escalationIntervalMonths?: number | null;
}
export interface AmendmentLine {
  kind: string;
  item?: string | null;
  feeType?: string | null;
  before?: unknown;
  after?: unknown;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  amountFen?: number | null;
}
export interface LineParts {
  what: string;
  before?: string;
  after?: string;
  when?: string;
  note?: string;
}

const money = (v: string | number) => `¥${Number(v).toFixed(2)}`;

/** "¥5500.00 (Per month)", "3.5% of usage", "Metered: ¥1.20 per kWh" ... */
export function rateText(t: TFunction, r: RateValue | null | undefined): string {
  if (!r) return "—";
  const basis = t(`contracts.${camel(r.rateBasis)}`);
  const method = t(`contracts.${camel(r.calculationMethod)}`);
  switch (r.calculationMethod) {
    case "usage_fee_percent":
      return `${Number(r.amountOrRate)}% (${basis})`;
    case "metered_amount":
      return method;
    case "metered":
    case "usage_fee_per_unit":
      return `${method}: ${money(r.amountOrRate)}${r.unit ? ` / ${r.unit}` : ""}`;
    case "percentage_escalation":
      return `${money(r.amountOrRate)} (${basis}) +${Number(r.escalationPercentage ?? 0)}% / ${r.escalationIntervalMonths ?? "?"} ${t("amendLine.months")}`;
    case "per_sqm":
      return `${money(r.amountOrRate)} (${basis})`;
    default:
      return `${money(r.amountOrRate)} (${basis})`;
  }
}

const value = (t: TFunction, v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return t(`audit.values.${v}`, { defaultValue: v });
  return String(v);
};

const period = (t: TFunction, from?: string | null, to?: string | null) => (from && to ? `${from} → ${to}` : from ? t("amendLine.from", { date: from }) : to ? t("amendLine.until", { date: to }) : "");

function lateText(t: TFunction, r: unknown): string {
  if (!r || typeof r !== "object") return "—";
  const x = r as { enabled?: unknown; dailyRatePermille?: unknown; capFen?: unknown };
  if (x.enabled === false || x.enabled === 0) return t("audit.no");
  if (x.enabled === null || x.enabled === undefined) return "—";
  return [t("audit.yes"), x.dailyRatePermille ? `${x.dailyRatePermille}‰ / ${t("amendLine.day")}` : "", x.capFen ? `${t("audit.fields.latePenaltyCapFen")} ${yuan(Number(x.capFen))}` : ""].filter(Boolean).join(", ");
}

function depositText(t: TFunction, d: unknown): string {
  if (!d || typeof d !== "object") return "—";
  const x = d as { requirementType?: string; fixedAmountFen?: number | null; formulaBasis?: string | null };
  return x.requirementType === "fixed" ? `${t("contracts.fixed")} ${yuan(Number(x.fixedAmountFen ?? 0))}` : `${t("contracts.formula")}: ${x.formulaBasis ?? ""}`;
}

/** A change split into what / before / after / when, for tables and for one-line text. */
export function lineParts(t: TFunction, l: AmendmentLine): LineParts {
  const item = l.item ? streamName(t, l.item, l.feeType ?? l.item) : "";
  const when = period(t, l.from, l.to);
  switch (l.kind) {
    case "term_end":
      return { what: t("amendLine.termEnd"), before: value(t, l.before), after: value(t, l.after) };
    case "renewal_notice":
      return { what: t("amendLine.renewalNotice"), before: value(t, l.before), after: value(t, l.after) };
    case "special_terms":
      return { what: t("amendLine.specialTerms"), before: value(t, l.before), after: value(t, l.after) };
    case "status":
      return { what: t("amendLine.status"), before: l.before ? t(`contracts.${l.before}`, { defaultValue: String(l.before) }) : "—", after: t(`contracts.${l.after}`, { defaultValue: String(l.after) }), when: l.from ?? undefined };
    case "unit_added":
      return { what: `${t("amendLine.unitAdded")}: ${item || l.item || ""}`, after: `${value(t, l.after)} ${t("amendLine.sqm")}`, when };
    case "unit_ended":
      return { what: `${t("amendLine.unitEnded")}: ${l.item ?? ""}`, before: l.before ? String(l.before) : t("amendLine.open"), after: l.to ?? undefined };
    case "stream_added":
      return { what: `${t("amendLine.newFee")}: ${item}`, after: rateText(t, l.after as RateValue), when };
    case "rate":
      return { what: item || t("amendLine.rate"), before: rateText(t, l.before as RateValue | null), after: rateText(t, l.after as RateValue), when };
    case "concession":
      return { what: `${t("amendLine.discount")}: ${item || t("audit.allItems")}`, after: `${Number(l.after)}%`, when, note: l.note ?? undefined };
    case "deposit":
      return { what: t("amendLine.deposit"), after: depositText(t, l.after), when: l.from ?? undefined, note: l.note ?? undefined };
    case "billing_rule":
      return { what: t(`audit.fields.${l.item}`, { defaultValue: String(l.item) }), before: value(t, l.before), after: value(t, l.after), when: l.from ?? undefined };
    case "late_fee":
      return { what: t("amendLine.lateFee"), before: lateText(t, l.before), after: lateText(t, l.after), when: l.from ?? undefined };
    case "document_voided":
      return { what: `${t("amendLine.documentVoided")}: ${l.item ? docDisplayName(t, { name: l.item === l.feeType ? null : l.item, docType: l.feeType ?? "other" }) : "—"}` };
    case "adjustment":
      return { what: `${t("amendLine.adjustment")}: ${item}`, after: l.amountFen !== null && l.amountFen !== undefined ? yuan(l.amountFen) : undefined, when, note: l.note ?? undefined };
    default:
      return { what: l.kind };
  }
}

/** One line of text: "Rent: ¥5000.00 (Per month) → ¥5500.00 (Per month), from 2026-11-01". */
export function lineText(t: TFunction, l: AmendmentLine): string {
  const p = lineParts(t, l);
  const change = p.before !== undefined && p.after !== undefined ? `${p.before} → ${p.after}` : p.after ?? p.before ?? "";
  return `${p.what}${change ? `: ${change}` : ""}${p.when ? `, ${p.when}` : ""}${p.note ? ` (${p.note})` : ""}`;
}
