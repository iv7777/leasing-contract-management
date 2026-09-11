import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contracts,
  rateSchedule,
  pricingStreams,
  depositTerms,
  depositTransactions,
  units,
  contractUnits,
  properties,
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { canAccessContract } from "../lib/contractScope.js";
import { loadLedgerInputs } from "../billing/ledgerLoad.js";
import { computeChargeBalance, computeDepositBalance } from "../billing/ledger.js";
import { computeReminders, type ContractReminderInput } from "../reports/reminders.js";
import { computeOccupancy } from "../reports/occupancy.js";
import { todayInChina } from "@lcm/shared";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get("/reminders", (req, res) => {
  const asOfDate = (req.query.asOf as string) ?? todayInChina();
  const allContracts = db.select().from(contracts).all();
  const visible = allContracts.filter((c) => canAccessContract(req.user!, c.id));

  const inputs: ContractReminderInput[] = visible.map((contract) => {
    const streams = db.select().from(pricingStreams).where(eq(pricingStreams.contractId, contract.id)).all();
    const streamIds = streams.map((s) => s.id);
    const rates = streamIds.length ? db.select().from(rateSchedule).all().filter((r) => streamIds.includes(r.pricingStreamId)) : [];
    const upcomingRateChanges = rates
      .filter((r) => r.effectiveStart >= asOfDate)
      .map((r) => ({
        effectiveStart: r.effectiveStart,
        pricingStreamLabel: streams.find((s) => s.id === r.pricingStreamId)?.label ?? String(r.pricingStreamId),
      }));

    const deposits = db.select().from(depositTerms).where(eq(depositTerms.contractId, contract.id)).all();
    const latestDeposit = deposits.filter((d) => d.effectiveStart <= asOfDate).sort((a, b) => (a.effectiveStart < b.effectiveStart ? 1 : -1))[0];
    const depositRequiredFen = latestDeposit?.requirementType === "fixed" ? latestDeposit.fixedAmountFen ?? null : null;
    const depositWaived = latestDeposit?.waiverMet === true;

    const depositTxns = db.select().from(depositTransactions).where(eq(depositTransactions.contractId, contract.id)).all();
    const depositHeldFen = computeDepositBalance(depositTxns.map((t) => ({ amountFen: t.amountFen, transactionDate: t.transactionDate })), asOfDate);

    const ledger = loadLedgerInputs(contract.id);
    const chargeBalances = ledger.charges.map((c) => ({
      ...computeChargeBalance(c, ledger.adjustments, ledger.allocations, asOfDate),
      dueDate: c.dueDate,
    }));

    return {
      contractId: contract.id,
      referenceNumber: contract.referenceNumber,
      status: contract.status,
      termEnd: contract.termEnd,
      renewalNoticeDays: contract.renewalNoticeDays,
      upcomingRateChanges,
      depositRequiredFen,
      depositWaived,
      depositHeldFen,
      chargeBalances,
    };
  });

  const reminders = computeReminders(inputs, asOfDate);
  res.json({ reminders });
});

reportsRouter.get("/reports/occupancy", (req, res) => {
  const asOfDate = (req.query.date as string) ?? todayInChina();
  const propertyIdFilter = req.query.propertyId ? Number(req.query.propertyId) : undefined;

  const allProperties = db.select().from(properties).all();
  const visibleProperties = allProperties.filter(
    (p) => (req.user!.role === "admin" || req.user!.propertyIds.includes(p.id)) && (!propertyIdFilter || p.id === propertyIdFilter),
  );
  const visiblePropertyIds = new Set(visibleProperties.map((p) => p.id));

  const allUnits = db.select().from(units).all().filter((u) => visiblePropertyIds.has(u.propertyId));

  const activeContractIds = new Set(db.select().from(contracts).all().filter((c) => c.status === "active").map((c) => c.id));
  const activeContractUnits = db
    .select()
    .from(contractUnits)
    .all()
    .filter((cu) => activeContractIds.has(cu.contractId));

  const report = computeOccupancy(allUnits, activeContractUnits, asOfDate);
  res.json({ report });
});
