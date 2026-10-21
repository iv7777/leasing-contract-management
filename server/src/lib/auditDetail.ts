import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { contracts, pricingStreams, units, contractUnits } from "../db/schema.js";

/** Helpers that turn a change into the facts worth keeping in the audit log:
 * who/what it concerned (by name, so the entry stays readable if the record is
 * later renamed or deleted) and exactly which fields moved from what to what. */

const NOISE = new Set(["updatedAt", "createdAt", "id"]);

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Only the fields whose value actually changed, as {field: {from, to}}. */
export function changesBetween(before: object, after: object, ignore: string[] = []): Changes {
  const out: Changes = {};
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    if (NOISE.has(key) || ignore.includes(key)) continue;
    const from = b[key] ?? null;
    const to = a[key] ?? null;
    if (from !== to) out[key] = { from, to };
  }
  return out;
}

export function contractRef(contractId: number): string | null {
  return db.select({ r: contracts.referenceNumber }).from(contracts).where(eq(contracts.id, contractId)).get()?.r ?? null;
}

export function streamName(streamId: number | null): string | null {
  if (streamId === null) return null;
  const s = db.select().from(pricingStreams).where(eq(pricingStreams.id, streamId)).get();
  return s ? (s.label ?? s.feeType) : null;
}

export function unitName(contractUnitId: number): string | null {
  const cu = db.select().from(contractUnits).where(eq(contractUnits.id, contractUnitId)).get();
  if (!cu) return null;
  return db.select({ l: units.unitLabel }).from(units).where(eq(units.id, cu.unitId)).get()?.l ?? null;
}

type RateLike = {
  calculationMethod: string;
  amountOrRate: string;
  rateBasis: string;
  unit?: string | null;
  effectiveStart: string;
  effectiveEnd?: string | null;
  linkedStreamId?: number | null;
};

/** One rate row as a short, flat record. */
export function rateFacts(r: RateLike) {
  return {
    calculationMethod: r.calculationMethod,
    amountOrRate: r.amountOrRate,
    rateBasis: r.rateBasis,
    unit: r.unit ?? null,
    effectiveStart: r.effectiveStart,
    effectiveEnd: r.effectiveEnd ?? null,
    follows: r.linkedStreamId ? streamName(r.linkedStreamId) : null,
  };
}

/** Rate fields for diffs: the linked item is shown by name, not by id. */
export function rateForDiff(r: RateLike & { linkedStreamId?: number | null; notes?: string | null }) {
  const { linkedStreamId, ...rest } = r;
  return { ...rest, follows: linkedStreamId ? streamName(linkedStreamId) : null };
}

import { charges, receipts } from "../db/schema.js";

/** A bill, described by contract, item and period. */
export function chargeFacts(chargeId: number) {
  const c = db.select().from(charges).where(eq(charges.id, chargeId)).get();
  if (!c) return { charge: `#${chargeId}` };
  return { contract: contractRef(c.contractId), item: streamName(c.pricingStreamId) ?? c.feeType, servicePeriod: `${c.serviceStart} → ${c.serviceEnd}`, chargeAmountFen: c.amountFen };
}

/** A receipt, described by contract, date, method and amount. */
export function receiptFacts(receiptId: number) {
  const r = db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
  if (!r) return { receipt: `#${receiptId}` };
  return { contract: contractRef(r.contractId), receivedDate: r.receivedDate, paymentMethod: r.paymentMethod, receiptAmountFen: r.amountFen };
}

import { amendments } from "../db/schema.js";

/** An amendment, described by contract, kind, effective date and what it changes
 * (category → how many entries), so approving or rejecting it leaves a readable trail. */
export function amendmentFacts(a: typeof amendments.$inferSelect) {
  let applied: Record<string, number> | undefined;
  try {
    const c = JSON.parse(a.changesJson) as Record<string, unknown>;
    applied = {};
    for (const [k, v] of Object.entries(c)) {
      if (Array.isArray(v) && v.length) applied[k] = v.length;
      else if (v && typeof v === "object" && Object.keys(v as object).length) applied[k] = 1;
    }
    if (Object.keys(applied).length === 0) applied = undefined;
  } catch {
    applied = undefined;
  }
  return { contract: contractRef(a.contractId), amendmentType: a.type, effectiveDate: a.effectiveDate, ...(applied ? { applied } : {}) };
}

import { documents, parties, properties, users } from "../db/schema.js";

/** A short human label for a record (contract reference, property / party /
 * user name, unit label, document name), or null if it no longer exists. */
export function entityLabel(entityType: string, entityId: number | null): string | null {
  if (entityId === null) return null;
  switch (entityType) {
    case "contract":
      return contractRef(entityId);
    case "property":
      return db.select({ n: properties.name }).from(properties).where(eq(properties.id, entityId)).get()?.n ?? null;
    case "unit": {
      const u = db.select().from(units).where(eq(units.id, entityId)).get();
      if (!u) return null;
      const p = db.select({ n: properties.name }).from(properties).where(eq(properties.id, u.propertyId)).get()?.n;
      return p ? `${p} / ${u.unitLabel}` : u.unitLabel;
    }
    case "party":
      return db.select({ n: parties.name }).from(parties).where(eq(parties.id, entityId)).get()?.n ?? null;
    case "user":
      return db.select({ n: users.name }).from(users).where(eq(users.id, entityId)).get()?.n ?? null;
    case "document": {
      const d = db.select().from(documents).where(eq(documents.id, entityId)).get();
      return d ? (d.name ?? d.docType) : null;
    }
    case "charge":
      return chargeFacts(entityId).contract ?? null;
    case "receipt":
      return receiptFacts(entityId).contract ?? null;
    case "amendment": {
      const a = db.select().from(amendments).where(eq(amendments.id, entityId)).get();
      return a ? contractRef(a.contractId) : null;
    }
    default:
      return null;
  }
}

/** What a document belongs to, e.g. "contract A-101". */
export function ownerLabel(ownerType: string, ownerId: number): string | null {
  return entityLabel(ownerType, ownerId);
}
