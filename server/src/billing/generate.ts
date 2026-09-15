import { eq } from "drizzle-orm";
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
import type { IsoDate } from "@lcm/shared";

export interface GenerateResult {
  created: number;
  skippedExisting: number;
  skippedMissingUsage: number;
}

/** Loads a contract's approved/effective terms and generates charges for one
 * calendar month, skipping any billing item that already has a posted
 * charge (the dedupe unique index is the final backstop; checking first
 * keeps a repeated/retried job from even attempting a duplicate insert). */
export function generateChargesForContractMonth(contractId: number, periodStart: IsoDate, periodEnd: IsoDate): GenerateResult {
  const contract = db.select().from(contracts).where(eq(contracts.id, contractId)).get();
  if (!contract) throw new Error(`Contract ${contractId} not found`);

  const rules = db.select().from(billingRules).where(eq(billingRules.contractId, contractId)).get();
  if (!rules) throw new Error(`Contract ${contractId} has no billing rules configured`);

  const cUnits = db.select().from(contractUnits).where(eq(contractUnits.contractId, contractId)).all();
  const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contractId)).all();
  const streamUnitRows = streams.length
    ? db.select().from(pricingStreamUnits).all().filter((psu) => streams.some((s) => s.id === psu.pricingStreamId))
    : [];
  const rateRows = streams.length
    ? db.select().from(rateSchedule).all().filter((r) => streams.some((s) => s.id === r.pricingStreamId))
    : [];
  const concessionRows = db.select().from(concessions).where(eq(concessions.contractId, contractId)).all();
  const usageRows = db.select().from(usageEntries).where(eq(usageEntries.contractId, contractId)).all();

  const { lines, skippedMissingUsage } = generateChargeLines(
    {
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
    },
    periodStart,
    periodEnd,
  );

  let created = 0;
  let skippedExisting = 0;

  for (const line of lines) {
    const existing = db
      .select()
      .from(charges)
      .all()
      .find(
        (c) =>
          c.contractId === contractId &&
          c.pricingStreamId === line.pricingStreamId &&
          c.serviceStart === line.serviceStart &&
          c.serviceEnd === line.serviceEnd,
      );
    if (existing) {
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
        sourceContractVersion: contract.versionNumber,
      })
      .onConflictDoNothing()
      .run();
    created++;
  }

  return { created, skippedExisting, skippedMissingUsage: skippedMissingUsage.length };
}
