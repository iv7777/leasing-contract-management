import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeAllocations, type OpenCharge } from "./allocation.js";

const c = (chargeId: number, dueDate: string, balanceFen: number, serviceStart = dueDate): OpenCharge => ({ chargeId, dueDate, serviceStart, balanceFen });

test("pays the oldest due charge first and splits across several", () => {
  const open = [c(3, "2026-03-01", 100), c(1, "2026-01-01", 100), c(2, "2026-02-01", 100)];
  const r = proposeAllocations(open, 250);
  assert.deepEqual(r.allocations, [
    { chargeId: 1, amountFen: 100 },
    { chargeId: 2, amountFen: 100 },
    { chargeId: 3, amountFen: 50 },
  ]);
  assert.equal(r.unallocatedFen, 0);
});

test("a partial payment leaves the rest of that charge owing", () => {
  const r = proposeAllocations([c(1, "2026-01-01", 100)], 40);
  assert.deepEqual(r.allocations, [{ chargeId: 1, amountFen: 40 }]);
  assert.equal(r.unallocatedFen, 0);
});

test("an overpayment never over-allocates; the remainder is unallocated credit", () => {
  const r = proposeAllocations([c(1, "2026-01-01", 100), c(2, "2026-02-01", 50)], 500);
  assert.deepEqual(r.allocations, [
    { chargeId: 1, amountFen: 100 },
    { chargeId: 2, amountFen: 50 },
  ]);
  assert.equal(r.unallocatedFen, 350);
});

test("same due date: earlier service period, then lower id, goes first; settled charges are skipped", () => {
  const open = [c(5, "2026-02-01", 100, "2026-02-01"), c(4, "2026-02-01", 100, "2026-01-01"), c(6, "2026-01-01", 0)];
  const r = proposeAllocations(open, 150);
  assert.deepEqual(r.allocations, [
    { chargeId: 4, amountFen: 100 },
    { chargeId: 5, amountFen: 50 },
  ]);
});

test("nothing owed means the whole payment is credit", () => {
  const r = proposeAllocations([], 300);
  assert.deepEqual(r, { allocations: [], unallocatedFen: 300 });
});
