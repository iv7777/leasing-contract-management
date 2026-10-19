import { Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { billingRules, billingRuns, charges, chargeAdjustments, contracts, parties, receiptAllocations } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { canAccessContract, rejectIfDraft } from "../lib/contractScope.js";
import { recordAudit } from "../lib/audit.js";
import { applyPlan, billingEligibility, currentCutoff, planBilling, type BillingPlan } from "../billing/autoBilling.js";
import { loadChargeContext } from "../billing/generate.js";
import { runDailyBilling } from "../jobs/billing.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { loadDepositStatus } from "../billing/depositLoad.js";
import { computeChargeBalance } from "../billing/ledger.js";
import { buildOverview, type OverviewContractInput } from "../billing/overviewCalc.js";
import { activeContractIds, buildOverdueSummary } from "../billing/overdueSummary.js";
import { monthEndOf, monthStartOf } from "../billing/billingSchedule.js";
import { addMonths, todayInChina } from "@lcm/shared";

export const billingRouter = Router();
billingRouter.use(requireAuth);

const forbidden = { error: { code: "forbidden", message: "Not assigned to every property this agreement covers." } };

/** The client never sees the calculation snapshots — only what an Admin
 * needs to eyeball against the paper ledger before confirming. */
function previewDto(plan: BillingPlan) {
  return {
    cutoff: plan.cutoff,
    totalFen: plan.totalFen,
    charges: plan.charges.map(({ snapshotJson: _snapshot, ...c }) => c),
    missingReadings: plan.missingReadings,
  };
}

function loadForCatchUp(contractId: number, res: import("express").Response) {
  let ctx;
  try {
    ctx = loadChargeContext(contractId);
  } catch {
    res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
    return null;
  }
  const eligibility = billingEligibility(ctx);
  if (!eligibility.ok) {
    const message =
      eligibility.reason === "not_active"
        ? "Only an active contract can be billed automatically — activate it first."
        : "Automatic billing covers monthly-billed contracts only; generate quarterly/yearly charges manually.";
    res.status(409).json({ error: { code: "not_eligible", reason: eligibility.reason, message } });
    return null;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Catch-up: bill a contract from day one, after an Admin has reviewed it
// ---------------------------------------------------------------------------

billingRouter.post("/contracts/:id/billing/catch-up/preview", requireRole("admin"), (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) return res.status(403).json(forbidden);
  const ctx = loadForCatchUp(contractId, res);
  if (!ctx) return;

  res.json(previewDto(planBilling(ctx, currentCutoff())));
});

const catchUpSchema = z.object({ expectedTotalFen: z.number().int(), expectedCount: z.number().int() });

billingRouter.post("/contracts/:id/billing/catch-up", requireRole("admin"), (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) return res.status(403).json(forbidden);
  const parsed = catchUpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Confirm the previewed totals to proceed." } });
  const ctx = loadForCatchUp(contractId, res);
  if (!ctx) return;

  // Recomputed server-side; the preview's numbers only confirm the Admin is
  // approving what is about to be posted, not something that has since changed.
  const plan = planBilling(ctx, currentCutoff());
  if (plan.totalFen !== parsed.data.expectedTotalFen || plan.charges.length !== parsed.data.expectedCount) {
    return res.status(409).json({
      error: { code: "plan_changed", message: "The contract's terms or readings changed since the preview. Review the new preview and confirm again." },
    });
  }

  const created = applyPlan(ctx, plan, true);
  recordAudit({
    actorUserId: req.user!.id,
    action: "billing_catch_up",
    entityType: "contract",
    entityId: contractId,
    details: { created, totalFen: plan.totalFen, cutoff: plan.cutoff, missingReadings: plan.missingReadings.length },
  });
  res.json({ created, totalFen: plan.totalFen, missingReadings: plan.missingReadings.length });
});

billingRouter.post("/contracts/:id/billing/pause", requireRole("admin"), (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) return res.status(403).json(forbidden);
  const updated = db.update(billingRules).set({ autoBilling: false }).where(eq(billingRules.contractId, contractId)).returning().get();
  if (!updated) return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  recordAudit({ actorUserId: req.user!.id, action: "auto_billing_paused", entityType: "contract", entityId: contractId });
  res.json({ billingRules: updated });
});

// ---------------------------------------------------------------------------
// Void: the undo for a mistaken charge (append-only — the row stays, flagged)
// ---------------------------------------------------------------------------

const voidSchema = z.object({ reason: z.string().trim().min(3) });

billingRouter.post("/charges/:id/void", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const charge = db.select().from(charges).where(eq(charges.id, id)).get();
  if (!charge) return res.status(404).json({ error: { code: "not_found", message: "Charge not found." } });
  if (!canAccessContract(req.user!, charge.contractId)) return res.status(403).json(forbidden);
  if (rejectIfDraft(res, charge.contractId)) return;
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "A reason is required to void a charge." } });

  if (charge.status === "voided") {
    return res.status(409).json({ error: { code: "already_voided", message: "This charge is already voided." } });
  }
  const netAllocated = db.select().from(receiptAllocations).where(eq(receiptAllocations.chargeId, id)).all().reduce((s, a) => s + a.amountFen, 0);
  if (netAllocated !== 0) {
    return res.status(409).json({
      error: { code: "has_payments", message: "Payments are applied to this charge. Reverse those allocations first, then void it." },
    });
  }
  if (db.select().from(chargeAdjustments).where(eq(chargeAdjustments.chargeId, id)).all().length > 0) {
    return res.status(409).json({ error: { code: "has_adjustments", message: "This charge has adjustments from an amendment and can't be voided." } });
  }

  const updated = db
    .update(charges)
    .set({ status: "voided", voidedAt: new Date().toISOString(), voidedBy: req.user!.id, voidReason: parsed.data.reason })
    .where(eq(charges.id, id))
    .returning()
    .get();
  recordAudit({
    actorUserId: req.user!.id,
    action: "charge_voided",
    entityType: "charge",
    entityId: id,
    reason: parsed.data.reason,
    details: { contractId: charge.contractId, amountFen: charge.amountFen, serviceStart: charge.serviceStart, serviceEnd: charge.serviceEnd },
  });
  res.json({ charge: updated });
});

// ---------------------------------------------------------------------------
// Nightly job history and manual trigger
// ---------------------------------------------------------------------------

billingRouter.get("/billing/runs", requireRole("admin"), (_req, res) => {
  const runs = db.select().from(billingRuns).orderBy(desc(billingRuns.id)).limit(100).all();
  res.json({ runs });
});

billingRouter.post("/billing/run", requireRole("admin"), (req, res) => {
  try {
    const summary = runDailyBilling("manual");
    recordAudit({ actorUserId: req.user!.id, action: "billing_run_triggered", entityType: "billing_run", entityId: summary.runId, details: summary });
    res.status(201).json(summary);
  } catch (err) {
    res.status(500).json({ error: { code: "billing_run_failed", message: err instanceof Error ? err.message : "Billing run failed." } });
  }
});

// ---------------------------------------------------------------------------
// "What's due" overview for whoever is logged in (scoped to their properties)
// ---------------------------------------------------------------------------

/** What a monthly contract has coming up: the dues from the plan that are
 * still ahead, through the end of next month. A contract not yet on automatic
 * billing still shows what is coming — but only dues still ahead of today: its
 * unbilled history is what Catch up billing is for, and would swamp the
 * forecast. Shared by the Dashboard and the contract's own tab. */
function projectContract(ctx: ReturnType<typeof loadChargeContext>, today: string, lookAheadCutoff: string) {
  const autoOn = ctx.rules.autoBilling;
  const plan = planBilling(ctx, lookAheadCutoff, today);
  return {
    autoOn,
    charges: plan.charges.filter((c) => autoOn || c.dueDate > today),
    missingReadings: autoOn ? plan.missingReadings : [],
  };
}

function lookAheadCutoffFor(today: string) {
  // Bills for the rest of this month are normally already posted by the
  // nightly job; look one month further so collectors can see what's next.
  return monthEndOf(addMonths(monthStartOf(today), 1));
}

billingRouter.get("/contracts/:id/billing/upcoming", (req, res) => {
  const contractId = Number(req.params.id);
  if (!canAccessContract(req.user!, contractId)) return res.status(403).json(forbidden);
  let ctx;
  try {
    ctx = loadChargeContext(contractId);
  } catch {
    return res.status(404).json({ error: { code: "not_found", message: "Contract not found." } });
  }
  const today = todayInChina();
  const cutoff = lookAheadCutoffFor(today);
  const base = { asOf: today, cutoff, status: ctx.contract.status, billingFrequency: ctx.rules.billingFrequency, autoBilling: ctx.rules.autoBilling };
  if (ctx.contract.status !== "active" || ctx.rules.billingFrequency !== "monthly") {
    return res.json({ ...base, items: [], totalFen: 0, missingReadings: [] });
  }
  const p = projectContract(ctx, today, cutoff);
  const items = p.charges
    .map((c) => ({ feeType: c.feeType, streamLabel: c.streamLabel, serviceStart: c.serviceStart, serviceEnd: c.serviceEnd, dueDate: c.dueDate, amountFen: c.amountFen }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.serviceStart.localeCompare(b.serviceStart));
  res.json({
    ...base,
    items,
    totalFen: items.reduce((sum, i) => sum + i.amountFen, 0),
    missingReadings: p.missingReadings.map((m) => ({ feeType: m.feeType, streamLabel: m.streamLabel, month: m.periodStart.slice(0, 7), dueDate: m.dueDate })),
  });
});

/** Lightweight "who is overdue" for the dots and tags on the list pages and
 * the contract page. Same visibility rules as the overview; pass contractId to
 * ask about one contract. */
billingRouter.get("/billing/overdue-summary", (req, res) => {
  const today = todayInChina();
  const only = req.query.contractId ? Number(req.query.contractId) : null;
  const ids = (only ? [only] : activeContractIds()).filter((id) => canAccessContract(req.user!, id));
  res.json({ asOf: today, ...buildOverdueSummary(ids, today) });
});

billingRouter.get("/billing/overview", (req, res) => {
  const today = todayInChina();
  const lookAheadCutoff = lookAheadCutoffFor(today);

  const tenantNames = new Map(db.select({ id: parties.id, name: parties.name }).from(parties).all().map((p) => [p.id, p.name]));
  const visible = db
    .select()
    .from(contracts)
    .where(eq(contracts.status, "active"))
    .all()
    .filter((c) => canAccessContract(req.user!, c.id));

  const inputs: OverviewContractInput[] = [];
  const missingReadings: { contractId: number; referenceNumber: string; tenantName: string; stream: string; feeType: string; month: string }[] = [];
  const depositIssues: { contractId: number; referenceNumber: string; tenantName: string; requiredFen: number; heldFen: number; shortfallFen: number; manual: boolean }[] = [];
  const notAutoBilled: { contractId: number; referenceNumber: string; tenantName: string; reason: "off" | "not_monthly" }[] = [];

  for (const contract of visible) {
    const tenantName = tenantNames.get(contract.tenantPartyId) ?? "";
    const deposit = loadDepositStatus(contract.id, today);
    if (deposit.state === "short" || deposit.state === "manual") {
      depositIssues.push({ contractId: contract.id, referenceNumber: contract.referenceNumber, tenantName, requiredFen: deposit.requiredFen, heldFen: deposit.heldFen, shortfallFen: deposit.shortfallFen, manual: deposit.state === "manual" });
    }
    const ledger = loadLedgerInputs(contract.id);
    const rawById = new Map(ledger.chargesRaw.map((c) => [c.id, c]));

    const balances = ledger.charges
      .filter((c) => c.status === "posted")
      .map((c) => {
        const b = computeChargeBalance(c, ledger.adjustments, ledger.allocations, today, ledger.overdueGraceDays);
        return { chargeId: c.id, feeType: rawById.get(c.id)!.feeType, serviceStart: c.serviceStart, dueDate: c.dueDate, balanceFen: b.balanceFen, isOverdue: b.isOverdue, daysOverdue: b.daysOverdue };
      });

    let projected: OverviewContractInput["projected"] = [];
    try {
      const ctx = loadChargeContext(contract.id);
      if (ctx.rules.billingFrequency !== "monthly") {
        notAutoBilled.push({ contractId: contract.id, referenceNumber: contract.referenceNumber, tenantName, reason: "not_monthly" });
      } else {
        if (!ctx.rules.autoBilling) notAutoBilled.push({ contractId: contract.id, referenceNumber: contract.referenceNumber, tenantName, reason: "off" });
        const p = projectContract(ctx, today, lookAheadCutoff);
        projected = p.charges.map((c) => ({ feeType: c.feeType, serviceStart: c.serviceStart, dueDate: c.dueDate, amountFen: c.amountFen }));
        for (const m of p.missingReadings) {
          missingReadings.push({ contractId: contract.id, referenceNumber: contract.referenceNumber, tenantName, stream: m.streamLabel, feeType: m.feeType, month: m.periodStart.slice(0, 7) });
        }
      }
    } catch {
      // A contract the planner can't read still shows what it owes.
    }

    inputs.push({ contractId: contract.id, referenceNumber: contract.referenceNumber, tenantName, charges: balances, projected });
  }

  const { totals, contracts: rows } = buildOverview(inputs, today);
  res.json({ asOf: today, totals, contracts: rows, missingReadings, depositIssues, notAutoBilled });
});
