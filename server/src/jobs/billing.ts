import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { billingRules, billingRuns, contracts } from "../db/schema.js";
import { applyPlan, billingEligibility, currentCutoff, planBilling } from "../billing/autoBilling.js";
import { loadChargeContext } from "../billing/generate.js";
import { recordAudit } from "../lib/audit.js";
import { todayInChina } from "@lcm/shared";

export interface BillingRunSummary {
  runId: number;
  status: "succeeded" | "partial" | "failed";
  contractsProcessed: number;
  chargesCreated: number;
  contractsFailed: number;
  missingReadings: number;
}

/** The nightly billing pass: for every active, monthly-billed contract that
 * has been switched on for automatic billing, post every charge that is
 * already due or falls due by the end of this month. Safe to run any number
 * of times — charges already posted are never touched, and a metered fee
 * whose reading hasn't been entered is simply picked up on a later night.
 * One contract failing never stops the others. */
export function runDailyBilling(trigger: "scheduled" | "manual"): BillingRunSummary {
  const startedAt = new Date().toISOString();
  const run = db.insert(billingRuns).values({ trigger, startedAt, status: "running" }).returning().get();

  const today = todayInChina();
  const cutoff = currentCutoff(today);

  const failures: { contractId: number; referenceNumber: string; error: string }[] = [];
  const missing: { contractId: number; referenceNumber: string; stream: string; period: string }[] = [];
  let processed = 0;
  let created = 0;

  try {
    const enabled = db
      .select({ contractId: billingRules.contractId, referenceNumber: contracts.referenceNumber })
      .from(billingRules)
      .innerJoin(contracts, eq(contracts.id, billingRules.contractId))
      .where(eq(billingRules.autoBilling, true))
      .all();

    for (const { contractId, referenceNumber } of enabled) {
      try {
        const ctx = loadChargeContext(contractId);
        if (!billingEligibility(ctx).ok) continue;

        const plan = planBilling(ctx, cutoff, today);
        const n = applyPlan(ctx, plan);
        processed++;
        created += n;
        for (const m of plan.missingReadings) {
          missing.push({ contractId, referenceNumber, stream: m.streamLabel, period: m.periodStart.slice(0, 7) });
        }
        if (n > 0) {
          recordAudit({
            actorUserId: null,
            action: "charges_auto_generated",
            entityType: "contract",
            entityId: contractId,
            details: { created: n, cutoff, run: run.id },
          });
        }
      } catch (err) {
        failures.push({ contractId, referenceNumber, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const status = failures.length === 0 ? "succeeded" : processed === 0 ? "failed" : "partial";
    db.update(billingRuns)
      .set({
        completedAt: new Date().toISOString(),
        status,
        contractsProcessed: processed,
        chargesCreated: created,
        contractsFailed: failures.length,
        missingReadings: missing.length,
        detailsJson: JSON.stringify({ failures, missingReadings: missing.slice(0, 200) }),
      })
      .where(eq(billingRuns.id, run.id))
      .run();

    return { runId: run.id, status, contractsProcessed: processed, chargesCreated: created, contractsFailed: failures.length, missingReadings: missing.length };
  } catch (err) {
    db.update(billingRuns)
      .set({ completedAt: new Date().toISOString(), status: "failed", error: err instanceof Error ? err.message : String(err), contractsProcessed: processed, chargesCreated: created })
      .where(eq(billingRuns.id, run.id))
      .run();
    throw err;
  }
}
