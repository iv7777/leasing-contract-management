import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview, type OverviewContractInput } from "./overviewCalc.js";

const TODAY = "2026-10-18";

const charge = (chargeId: number, dueDate: string, balanceFen: number, isOverdue = false, daysOverdue = 0) => ({
  chargeId,
  feeType: "rent",
  serviceStart: dueDate,
  dueDate,
  balanceFen,
  isOverdue,
  daysOverdue,
});

test("sorts a tenant's balances into overdue, due now, upcoming and projected", () => {
  const input: OverviewContractInput = {
    contractId: 1,
    referenceNumber: "C-1",
    tenantName: "Acme",
    charges: [
      charge(1, "2026-09-01", 100, true, 37), // overdue
      charge(2, "2026-10-01", 200, false), // due date passed but inside grace? not flagged overdue
      charge(3, "2026-10-25", 300), // billed, due later this month
      charge(4, "2026-08-01", 0), // paid — ignored
    ],
    projected: [{ feeType: "rent", serviceStart: "2026-11-01", dueDate: "2026-11-01", amountFen: 400 }],
  };
  const { totals, contracts } = buildOverview([input], TODAY);
  const c = contracts[0];
  assert.deepEqual(
    [c.overdueFen, c.dueFen, c.upcomingFen, c.projectedFen],
    [100, 200, 300, 400],
  );
  assert.equal(c.items.length, 4);
  assert.equal(totals.overdueCount, 1);
  assert.equal(totals.dueCount, 1);
});

test("next due date is the earliest coming bill, summed across that day's charges", () => {
  const input: OverviewContractInput = {
    contractId: 1,
    referenceNumber: "C-1",
    tenantName: "Acme",
    charges: [charge(3, "2026-10-25", 300)],
    projected: [
      { feeType: "rent", serviceStart: "2026-10-25", dueDate: "2026-10-25", amountFen: 50 },
      { feeType: "rent", serviceStart: "2026-11-01", dueDate: "2026-11-01", amountFen: 999 },
    ],
  };
  const c = buildOverview([input], TODAY).contracts[0];
  assert.equal(c.nextDueDate, "2026-10-25");
  assert.equal(c.nextDueFen, 350);
});

test("contracts with nothing owed or coming are omitted; the rest rank by overdue amount", () => {
  const empty: OverviewContractInput = { contractId: 9, referenceNumber: "C-9", tenantName: "Paid Up", charges: [charge(1, "2026-08-01", 0)], projected: [] };
  const small: OverviewContractInput = { contractId: 2, referenceNumber: "C-2", tenantName: "Small", charges: [charge(2, "2026-09-01", 100, true, 10)], projected: [] };
  const big: OverviewContractInput = { contractId: 3, referenceNumber: "C-3", tenantName: "Big", charges: [charge(3, "2026-09-01", 900, true, 10)], projected: [] };
  const { contracts, totals } = buildOverview([empty, small, big], TODAY);
  assert.deepEqual(contracts.map((c) => c.contractId), [3, 2]);
  assert.equal(totals.overdueFen, 1000);
  assert.equal(contracts[0].nextDueDate, null);
});
