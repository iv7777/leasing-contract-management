import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { amendments, charges, contractUnits, contractVersions, contracts, documents, pricingStreams, properties, rateSchedule, units } from "../db/schema.js";

/** What an amendment changes, one plain line per change with the old and the new value, worked out from the changes
 * it stores and the rows (and contract version snapshots) that still exist. Read-only: nothing here changes data.
 * The web page turns each line into words in the viewer's language. */
export interface RateValue {
  calculationMethod: string;
  amountOrRate: string;
  rateBasis: string;
  unit?: string | null;
  escalationPercentage?: string | null;
  escalationIntervalMonths?: number | null;
}

export interface AmendmentLine {
  kind:
    | "term_end"
    | "renewal_notice"
    | "special_terms"
    | "status"
    | "unit_added"
    | "unit_ended"
    | "stream_added"
    | "rate"
    | "concession"
    | "deposit"
    | "billing_rule"
    | "late_fee"
    | "document_voided"
    | "adjustment";
  /** The item, unit, document or setting the line is about. */
  item?: string | null;
  /** The item's fee type, so the page can show a default name in the viewer's language. */
  feeType?: string | null;
  before?: unknown;
  after?: unknown;
  from?: string | null;
  to?: string | null;
  note?: string | null;
  amountFen?: number | null;
}

type Amendment = typeof amendments.$inferSelect;
type Snapshot = { contract?: Record<string, unknown>; billingRules?: Record<string, unknown> | null };

const rateOf = (r: Record<string, unknown>): RateValue => ({
  calculationMethod: String(r.calculationMethod),
  amountOrRate: String(r.amountOrRate),
  rateBasis: String(r.rateBasis),
  unit: (r.unit as string | null | undefined) ?? null,
  escalationPercentage: (r.escalationPercentage as string | null | undefined) ?? null,
  escalationIntervalMonths: (r.escalationIntervalMonths as number | null | undefined) ?? null,
});

function snapshotAt(contractId: number, version: number): Snapshot | null {
  const row = db.select().from(contractVersions).where(and(eq(contractVersions.contractId, contractId), eq(contractVersions.versionNumber, version))).get();
  if (!row) return null;
  try {
    return JSON.parse(row.snapshotJson) as Snapshot;
  } catch {
    return null;
  }
}

function streamInfo(streamId: number | null): { item: string | null; feeType: string | null } {
  if (streamId === null) return { item: null, feeType: null };
  const s = db.select().from(pricingStreams).where(eq(pricingStreams.id, streamId)).get();
  return s ? { item: s.label ?? s.feeType, feeType: s.feeType } : { item: null, feeType: null };
}

function unitLabel(unitId: number): string | null {
  const u = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!u) return null;
  const p = db.select({ n: properties.name }).from(properties).where(eq(properties.id, u.propertyId)).get()?.n;
  return p ? `${p} / ${u.unitLabel}` : u.unitLabel;
}

const clip = (v: unknown) => (typeof v === "string" ? (v.length > 300 ? `${v.slice(0, 300)}…` : v) : null);

export function summarizeAmendment(a: Amendment): AmendmentLine[] {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(a.changesJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: AmendmentLine[] = [];
  // What the contract looked like before: its snapshot at the version this amendment was based on, or (while it is
  // still open) the contract as it is now.
  const base = snapshotAt(a.contractId, a.baseContractVersion);
  const liveContract = db.select().from(contracts).where(eq(contracts.id, a.contractId)).get() as unknown as Record<string, unknown> | undefined;
  const beforeContract = base?.contract ?? (a.status === "approved" ? undefined : liveContract);
  const beforeRules = base?.billingRules ?? null;

  const contract = c.contract as Record<string, unknown> | undefined;
  if (contract) {
    if (contract.termEnd !== undefined) out.push({ kind: "term_end", before: beforeContract?.termEnd ?? null, after: contract.termEnd });
    if (contract.renewalNoticeDays !== undefined) out.push({ kind: "renewal_notice", before: beforeContract?.renewalNoticeDays ?? null, after: contract.renewalNoticeDays });
    if (contract.specialTerms !== undefined) out.push({ kind: "special_terms", before: clip(beforeContract?.specialTerms), after: clip(contract.specialTerms) });
    if (contract.status !== undefined) out.push({ kind: "status", before: beforeContract?.status ?? null, after: contract.status, from: a.effectiveDate });
  }

  for (const u of (c.addUnits as Record<string, unknown>[] | undefined) ?? []) {
    out.push({ kind: "unit_added", item: unitLabel(Number(u.unitId)), after: String(u.contractedAreaSqm), from: String(u.effectiveStart), to: (u.effectiveEnd as string | undefined) ?? null });
  }
  for (const u of (c.endUnits as Record<string, unknown>[] | undefined) ?? []) {
    const cu = db.select().from(contractUnits).where(eq(contractUnits.id, Number(u.contractUnitId))).get();
    out.push({ kind: "unit_ended", item: cu ? unitLabel(cu.unitId) : null, before: cu?.effectiveEnd ?? null, to: String(u.effectiveEnd) });
  }
  for (const s of (c.addPricingStreams as Record<string, unknown>[] | undefined) ?? []) {
    const rate = (s.initialRate ?? {}) as Record<string, unknown>;
    out.push({
      kind: "stream_added",
      item: (s.label as string | undefined) ?? String(s.feeType),
      feeType: String(s.feeType),
      after: rateOf(rate),
      from: (rate.effectiveStart as string | undefined) ?? null,
      to: (rate.effectiveEnd as string | undefined) ?? null,
    });
  }
  for (const r of (c.addRateSchedule as Record<string, unknown>[] | undefined) ?? []) {
    const streamId = Number(r.pricingStreamId);
    const closeId = r.closePreviousRateScheduleId ? Number(r.closePreviousRateScheduleId) : null;
    const rows = db.select().from(rateSchedule).where(eq(rateSchedule.pricingStreamId, streamId)).all();
    const start = String(r.effectiveStart);
    // The rate it replaces, or the one that was in force on the day the new one starts.
    const prev = closeId ? rows.find((x) => x.id === closeId) : rows.filter((x) => x.effectiveStart < start && (!x.effectiveEnd || x.effectiveEnd >= start)).sort((x, y) => y.effectiveStart.localeCompare(x.effectiveStart))[0];
    out.push({
      kind: "rate",
      ...streamInfo(streamId),
      before: prev ? rateOf(prev as unknown as Record<string, unknown>) : null,
      after: rateOf(r),
      from: start,
      to: (r.effectiveEnd as string | undefined) ?? null,
    });
  }
  for (const k of (c.addConcessions as Record<string, unknown>[] | undefined) ?? []) {
    out.push({ kind: "concession", ...streamInfo(k.pricingStreamId === null ? null : Number(k.pricingStreamId)), after: String(k.discountPercentage), from: String(k.effectiveStart), to: String(k.effectiveEnd), note: (k.reason as string | undefined) ?? null });
  }
  for (const d of (c.addDepositTerms as Record<string, unknown>[] | undefined) ?? []) {
    out.push({
      kind: "deposit",
      after: { requirementType: d.requirementType, fixedAmountFen: d.fixedAmountFen ?? null, formulaBasis: d.formulaBasis ?? null },
      from: String(d.effectiveStart),
      note: (d.waiverConditionText as string | undefined) ?? null,
    });
  }
  for (const [k, v] of Object.entries((c.billingRules as Record<string, unknown> | undefined) ?? {})) {
    out.push({ kind: "billing_rule", item: k, before: beforeRules?.[k] ?? null, after: v, from: a.effectiveDate });
  }
  const late = c.latePenaltyRules as Record<string, unknown> | undefined;
  if (late) {
    const pick = (r?: Record<string, unknown> | null) => (r ? { enabled: r.latePenaltyEnabled ?? null, dailyRatePermille: r.latePenaltyDailyRatePermille ?? null, capFen: r.latePenaltyCapFen ?? null } : null);
    out.push({ kind: "late_fee", before: pick(beforeRules), after: pick(late), from: a.effectiveDate });
  }
  for (const id of (c.voidDocuments as number[] | undefined) ?? []) {
    const d = db.select().from(documents).where(eq(documents.id, id)).get();
    out.push({ kind: "document_voided", item: d ? d.name ?? d.docType : null, feeType: d?.docType ?? null });
  }
  for (const adj of (c.retroactiveAdjustments as Record<string, unknown>[] | undefined) ?? []) {
    const ch = db.select().from(charges).where(eq(charges.id, Number(adj.chargeId))).get();
    out.push({
      kind: "adjustment",
      ...(ch ? streamInfo(ch.pricingStreamId) : {}),
      from: ch?.serviceStart ?? null,
      to: ch?.serviceEnd ?? null,
      amountFen: Number(adj.amountFen),
      note: String(adj.reason),
    });
  }
  // The money and the fees first, then the terms and the housekeeping.
  const order = ["rate", "stream_added", "concession", "unit_added", "unit_ended", "deposit", "adjustment", "term_end", "status", "billing_rule", "late_fee", "renewal_notice", "special_terms", "document_voided"];
  return out.map((l, i) => ({ l, i })).sort((x, y) => order.indexOf(x.l.kind) - order.indexOf(y.l.kind) || x.i - y.i).map((x) => x.l);
}
