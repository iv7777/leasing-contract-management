import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { charges, billingRules } from "../db/schema.js";
import { generateChargeLines } from "./chargeEngine.js";
import { chargeKey, loadChargeContext, type ChargeContext } from "./generate.js";
import { monthEndOf, periodsToConsider } from "./billingSchedule.js";
import { todayInChina, type IsoDate } from "@lcm/shared";

export interface PlannedCharge {
  periodStart: IsoDate;
  serviceStart: IsoDate;
  serviceEnd: IsoDate;
  dueDate: IsoDate;
  pricingStreamId: number;
  streamLabel: string;
  feeType: string;
  amountFen: number;
  snapshotJson: string;
}

export interface MissingReading {
  pricingStreamId: number;
  streamLabel: string;
  feeType: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
}

export interface BillingPlan {
  contractId: number;
  cutoff: IsoDate;
  charges: PlannedCharge[];
  missingReadings: MissingReading[];
  totalFen: number;
}

/** The end of the current month in China — the nightly job bills everything
 * already due plus everything that falls due later this month. */
export function currentCutoff(today: IsoDate = todayInChina()): IsoDate {
  return monthEndOf(today);
}

/** Read-only: everything that would be billed for this contract right now —
 * every month from the lease's first through the cutoff whose charge is due
 * on or before it and not already posted — and which metered readings are
 * holding charges back. Posts nothing. */
export function planBilling(ctx: ChargeContext, cutoff: IsoDate, today: IsoDate = todayInChina()): BillingPlan {
  const labelOf = new Map(ctx.streams.map((s) => [s.id, s.label?.trim() || s.feeType]));
  const feeOf = new Map(ctx.streams.map((s) => [s.id, s.feeType]));

  const planned: PlannedCharge[] = [];
  const missing: MissingReading[] = [];

  for (const period of periodsToConsider(ctx.contract.termStart, ctx.contract.termEnd, ctx.input.billingRules, cutoff)) {
    const result = generateChargeLines(ctx.input, period.periodStart, period.periodEnd);

    for (const line of result.lines) {
      if (line.dueDate > cutoff) continue;
      if (ctx.existingKeys.has(chargeKey(line.pricingStreamId, line.serviceStart, line.serviceEnd))) continue;
      planned.push({
        periodStart: period.periodStart,
        serviceStart: line.serviceStart,
        serviceEnd: line.serviceEnd,
        dueDate: line.dueDate,
        pricingStreamId: line.pricingStreamId,
        streamLabel: labelOf.get(line.pricingStreamId) ?? line.feeType,
        feeType: line.feeType,
        amountFen: line.amountFen,
        snapshotJson: JSON.stringify(line.snapshot),
      });
    }

    for (const m of result.missingUsage) {
      // Only a reading that can already exist counts as missing: the usage
      // month must have ended, and the bill must be due by the cutoff.
      if (m.dueDate > cutoff || period.periodEnd >= today) continue;
      if (ctx.existingKeys.has(chargeKey(m.pricingStreamId, period.periodStart, period.periodEnd))) continue;
      missing.push({
        pricingStreamId: m.pricingStreamId,
        streamLabel: labelOf.get(m.pricingStreamId) ?? "",
        feeType: feeOf.get(m.pricingStreamId) ?? "",
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: m.dueDate,
      });
    }
  }

  return {
    contractId: ctx.contract.id,
    cutoff,
    charges: planned,
    missingReadings: missing,
    totalFen: planned.reduce((s, c) => s + c.amountFen, 0),
  };
}

/** Posts a plan's charges in one transaction (all or nothing) against the
 * contract version they were planned from. Returns how many were created;
 * rows lost to the dedupe index (a concurrent run) are not counted. */
export function applyPlan(ctx: ChargeContext, plan: BillingPlan, enableAutoBilling = false): number {
  return db.transaction((tx) => {
    let created = 0;
    for (const c of plan.charges) {
      const row = tx
        .insert(charges)
        .values({
          contractId: plan.contractId,
          pricingStreamId: c.pricingStreamId,
          feeType: c.feeType,
          serviceStart: c.serviceStart,
          serviceEnd: c.serviceEnd,
          dueDate: c.dueDate,
          amountFen: c.amountFen,
          calculationSnapshotJson: c.snapshotJson,
          sourceContractVersion: ctx.contract.versionNumber,
        })
        .onConflictDoNothing()
        .returning({ id: charges.id })
        .get();
      if (row) created++;
    }
    if (enableAutoBilling) {
      tx.update(billingRules).set({ autoBilling: true }).where(eq(billingRules.contractId, plan.contractId)).run();
    }
    return created;
  });
}

export type BillingEligibility = { ok: true } | { ok: false; reason: "not_active" | "not_monthly" };

/** Automatic billing only covers active, monthly-billed contracts: the
 * engine bills one calendar month at a time, so quarterly/yearly contracts
 * stay on manual generation rather than silently changing cadence. */
export function billingEligibility(ctx: ChargeContext): BillingEligibility {
  if (ctx.contract.status !== "active") return { ok: false, reason: "not_active" };
  if (ctx.rules.billingFrequency !== "monthly") return { ok: false, reason: "not_monthly" };
  return { ok: true };
}
