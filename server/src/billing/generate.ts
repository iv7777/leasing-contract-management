import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contracts,
  contractUnits,
  pricingStreams,
  pricingStreamUnits,
  rateSchedule,
  concessions,
  billingRules,
  charges,
  usageEntries,
} from "../db/schema.js";
import { generateChargeLines } from "./chargeEngine.js";
import { lastBillableDay } from "../lib/termination.js";
import type { ChargeEngineInput } from "./types.js";
import type { IsoDate } from "@lcm/shared";

export interface GenerateResult {
  created: number;
  skippedExisting: number;
  skippedMissingUsage: number;
}

export const chargeKey = (pricingStreamId: number, serviceStart: string, serviceEnd: string) =>
  `${pricingStreamId}|${serviceStart}|${serviceEnd}`;

export interface ChargeContext {
  contract: typeof contracts.$inferSelect;
  rules: typeof billingRules.$inferSelect;
  streams: (typeof pricingStreams.$inferSelect)[];
  input: ChargeEngineInput;
  /** The last day that may be billed: the term end, or an earlier approved termination. */
  billingEnd: string;
  /** Keys of charges already posted (voided ones don't count — voiding a charge
   * is how a period is billed again after a correction), so repeated or
   * overlapping runs never try to bill the same item twice. */
  existingKeys: Set<string>;
}

/** Loads a contract's approved/effective terms once, in the shape the pure
 * charge engine expects, plus which billing items already have a posted
 * charge. Callers that walk many months (catch-up, the nightly job) reuse
 * one context instead of re-querying per month. */
export function loadChargeContext(contractId: number): ChargeContext {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw new Error(`Contract ${contractId} not found`);

  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, contractId)).get();
  if (!rules) throw new Error(`Contract ${contractId} has no billing rules configured`);

  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  const streamIds = streams.map((s) => s.id);
  const streamUnitRows = streamIds.length ? db.select().from(pricingStreamUnits).where(inArray(pricingStreamUnits.pricingStreamId, streamIds)).all() : [];
  const rateRows = streamIds.length ? db.select().from(rateSchedule).where(inArray(rateSchedule.pricingStreamId, streamIds)).all() : [];
  const concessionRows = db.select().from(concessions).where(eq(concessions.contractId, contractId)).all();
  const usageRows = db.select().from(usageEntries).where(eq(usageEntries.contractId, contractId)).all();
  const posted = db
    .select({ s: charges.pricingStreamId, a: charges.serviceStart, b: charges.serviceEnd })
    .from(charges)
    .where(and(eq(charges.contractId, contractId), eq(charges.status, "posted")))
    .all();

  const billingEnd = lastBillableDay(contract);
  const input: ChargeEngineInput = {
    billingStart: contract.termStart,
    billingEnd,
    contractUnits: cUnits.map((u) => ({
      id: u.id,
      effectiveStart: u.effectiveStart,
      effectiveEnd: u.effectiveEnd,
      contractedAreaSqm: u.contractedAreaSqm,
    })),
    pricingStreams: streams.map((s) => ({ id: s.id, feeType: s.feeType, targetType: s.targetType })),
    pricingStreamUnits: streamUnitRows.map((r) => ({ pricingStreamId: r.pricingStreamId, contractUnitId: r.contractUnitId })),
    rateSchedule: rateRows.map((r) => ({
      id: r.id,
      pricingStreamId: r.pricingStreamId,
      effectiveStart: r.effectiveStart,
      effectiveEnd: r.effectiveEnd,
      calculationMethod: r.calculationMethod,
      amountOrRate: r.amountOrRate,
      rateBasis: r.rateBasis,
      escalationBase: r.escalationBase,
      escalationPercentage: r.escalationPercentage,
      escalationIntervalMonths: r.escalationIntervalMonths,
      unit: r.unit,
      linkedStreamId: r.linkedStreamId,
    })),
    concessions: concessionRows.map((c) => ({
      pricingStreamId: c.pricingStreamId,
      effectiveStart: c.effectiveStart,
      effectiveEnd: c.effectiveEnd,
      discountPercentage: c.discountPercentage,
      reason: c.reason,
    })),
    billingRules: { dueDay: rules.dueDay, dueMonthOffset: rules.dueMonthOffset },
    usageEntries: usageRows.map((u) => ({
      pricingStreamId: u.pricingStreamId,
      serviceStart: u.serviceStart,
      serviceEnd: u.serviceEnd,
      quantity: u.quantity,
    })),
  };

  return { contract, rules, streams, input, billingEnd, existingKeys: new Set(posted.map((p) => chargeKey(p.s, p.a, p.b))) };
}

/** Generates charges for one calendar month, skipping any billing item that
 * already has a posted charge (the partial unique index is the final
 * backstop; checking first keeps a repeated/retried job from even
 * attempting a duplicate insert). Backs the manual per-month button. */
export function generateChargesForContractMonth(contractId: number, periodStart: IsoDate, periodEnd: IsoDate): GenerateResult {
  const ctx = loadChargeContext(contractId);
  if (periodStart > ctx.billingEnd) {
    throw new Error(`Contract ${contractId} ends ${ctx.billingEnd}; cannot generate charges for a period starting ${periodStart}.`);
  }

  const { lines, skippedMissingUsage } = generateChargeLines(ctx.input, periodStart, periodEnd);

  let created = 0;
  let skippedExisting = 0;
  for (const line of lines) {
    if (ctx.existingKeys.has(chargeKey(line.pricingStreamId, line.serviceStart, line.serviceEnd))) {
      skippedExisting++;
      continue;
    }
    db.insert(charges)
      .values({
        contractId,
        pricingStreamId: line.pricingStreamId,
        feeType: line.feeType,
        serviceStart: line.serviceStart,
        serviceEnd: line.serviceEnd,
        dueDate: line.dueDate,
        amountFen: line.amountFen,
        calculationSnapshotJson: JSON.stringify(line.snapshot),
        sourceContractVersion: ctx.contract.versionNumber,
      })
      .onConflictDoNothing()
      .run();
    created++;
  }

  return { created, skippedExisting, skippedMissingUsage: skippedMissingUsage.length };
}

/** Creates again the bills of some pricing streams for one month (those that have no posted
 * charge, e.g. because it was just voided), leaving every other stream alone. Used when a
 * meter reading is corrected after its bill was made. */
export function rebillStreams(contractId: number, periodStart: IsoDate, periodEnd: IsoDate, streamIds: number[]): number {
  const ctx = loadChargeContext(contractId);
  const { lines } = generateChargeLines(ctx.input, periodStart, periodEnd);
  let created = 0;
  for (const line of lines) {
    if (!streamIds.includes(line.pricingStreamId)) continue;
    if (ctx.existingKeys.has(chargeKey(line.pricingStreamId, line.serviceStart, line.serviceEnd))) continue;
    db.insert(charges)
      .values({
        contractId,
        pricingStreamId: line.pricingStreamId,
        feeType: line.feeType,
        serviceStart: line.serviceStart,
        serviceEnd: line.serviceEnd,
        dueDate: line.dueDate,
        amountFen: line.amountFen,
        calculationSnapshotJson: JSON.stringify(line.snapshot),
        sourceContractVersion: ctx.contract.versionNumber,
      })
      .onConflictDoNothing()
      .run();
    created++;
  }
  return created;
}
