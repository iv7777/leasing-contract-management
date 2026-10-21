import { test } from "node:test";
import assert from "node:assert/strict";
import { openingStanding, planOpening, provisionalUntil } from "./openingBalance.js";

const bills = [
  { chargeId: 3, dueDate: "2026-03-01", serviceStart: "2026-03-01", balanceFen: 100000 },
  { chargeId: 1, dueDate: "2026-01-01", serviceStart: "2026-01-01", balanceFen: 100000 },
  { chargeId: 2, dueDate: "2026-02-01", serviceStart: "2026-02-01", balanceFen: 100000 },
];

test("by default the oldest bills are paid and the newest carry the balance", () => {
  const plan = planOpening(bills, 150000);
  assert.equal(plan.billedFen, 300000);
  assert.equal(plan.paymentFen, 150000);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.rows.map((r) => [r.chargeId, r.paidFen, r.unpaidFen]), [
    [1, 100000, 0],
    [2, 50000, 50000],
    [3, 0, 100000],
  ]);
});

test("a balance on a bill boundary leaves whole bills unpaid", () => {
  const plan = planOpening(bills, 200000);
  assert.deepEqual(plan.rows.map((r) => r.unpaidFen), [0, 100000, 100000]);
});

test("a zero balance pays everything; a balance equal to the total pays nothing", () => {
  assert.equal(planOpening(bills, 0).paymentFen, 300000);
  const all = planOpening(bills, 300000);
  assert.equal(all.paymentFen, 0);
  assert.deepEqual(all.rows.map((r) => r.unpaidFen), [100000, 100000, 100000]);
});

test("a balance larger than everything billed, or negative, is a problem", () => {
  assert.deepEqual(planOpening(bills, 300001).problems, ["balance_exceeds_billed"]);
  assert.deepEqual(planOpening(bills, -1).problems, ["negative_balance"]);
});

test("the Admin can choose which bills stay unpaid, as long as it adds up to the balance", () => {
  const plan = planOpening(bills, 120000, [
    { chargeId: 1, unpaidFen: 100000 },
    { chargeId: 3, unpaidFen: 20000 },
  ]);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.paymentFen, 180000);
  assert.deepEqual(plan.rows.map((r) => [r.chargeId, r.paidFen, r.unpaidFen]), [
    [1, 0, 100000],
    [2, 100000, 0],
    [3, 80000, 20000],
  ]);
});

test("a chosen split that doesn't add up, or exceeds a bill, is refused", () => {
  assert.deepEqual(planOpening(bills, 120000, [{ chargeId: 1, unpaidFen: 100000 }]).problems, ["unpaid_total_mismatch"]);
  assert.deepEqual(planOpening(bills, 120000, [{ chargeId: 1, unpaidFen: 120000 }]).problems, ["unpaid_exceeds_bill"]);
  assert.deepEqual(planOpening(bills, 120000, [{ chargeId: 9, unpaidFen: 120000 }]).problems, ["unpaid_unknown_bill"]);
});

test("provisional lasts until finalized, a later payment, or 7 days", () => {
  const created = new Date("2026-10-01T00:00:00Z");
  const row = { status: "provisional" as const, provisionalUntil: provisionalUntil(created) };
  assert.equal(row.provisionalUntil, "2026-10-08T00:00:00.000Z");
  assert.deepEqual(openingStanding(row, false, new Date("2026-10-07T23:59:00Z")), { status: "provisional" });
  assert.deepEqual(openingStanding(row, false, new Date("2026-10-08T00:00:00Z")), { status: "final", finalBecause: "expired" });
  assert.deepEqual(openingStanding(row, true, new Date("2026-10-02T00:00:00Z")), { status: "final", finalBecause: "payment" });
  assert.deepEqual(openingStanding({ ...row, status: "final" }, false), { status: "final", finalBecause: "manual" });
  assert.deepEqual(openingStanding({ ...row, status: "reversed" }, true), { status: "reversed" });
});
