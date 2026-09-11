import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeChargeBalance,
  computeUnallocatedFen,
  validateAllocation,
  computeDepositBalance,
  computeMonthlyStatement,
  type ChargeInput,
} from "./ledger.js";

function charge(overrides: Partial<ChargeInput> = {}): ChargeInput {
  return { id: 1, amountFen: 100_000, dueDate: "2026-01-25", serviceStart: "2026-01-01", serviceEnd: "2026-01-31", status: "posted", ...overrides };
}

test("partial receipt leaves a correct remaining balance and not-yet-overdue status before the due date", () => {
  const c = charge();
  const balance = computeChargeBalance(c, [], [{ receiptId: 1, chargeId: 1, amountFen: 40_000 }], "2026-01-10");
  assert.equal(balance.balanceFen, 60_000);
  assert.equal(balance.isOverdue, false);
});

test("one receipt applied across multiple charges (multiple months) allocates correctly to each", () => {
  const jan = charge({ id: 1, serviceStart: "2026-01-01", dueDate: "2026-01-25" });
  const feb = charge({ id: 2, serviceStart: "2026-02-01", dueDate: "2026-02-25" });
  const allocations = [
    { receiptId: 1, chargeId: 1, amountFen: 100_000 },
    { receiptId: 1, chargeId: 2, amountFen: 100_000 },
  ];
  const receipt = { id: 1, amountFen: 200_000, status: "posted" as const };

  assert.equal(computeChargeBalance(jan, [], allocations, "2026-02-01").balanceFen, 0);
  assert.equal(computeChargeBalance(feb, [], allocations, "2026-02-01").balanceFen, 0);
  assert.equal(computeUnallocatedFen(receipt, allocations), 0);
});

test("overpayment leaves visible unallocated credit and does not inflate the charge past its balance", () => {
  const c = charge();
  const receipt = { id: 1, amountFen: 150_000, status: "posted" as const };
  const existingAllocations: { receiptId: number; chargeId: number; amountFen: number }[] = [];

  const validation = validateAllocation({
    receipt,
    existingReceiptAllocations: existingAllocations,
    charge: c,
    chargeAdjustments: [],
    existingChargeAllocations: existingAllocations,
    amountFen: 150_000, // trying to allocate the full overpayment to a 100,000 charge
    asOfDate: "2026-01-10",
  });
  assert.equal(validation.ok, false);

  // The correct allocation is capped at the charge's balance; the rest stays unallocated credit.
  const allocations = [{ receiptId: 1, chargeId: 1, amountFen: 100_000 }];
  assert.equal(computeChargeBalance(c, [], allocations, "2026-01-10").balanceFen, 0);
  assert.equal(computeUnallocatedFen(receipt, allocations), 50_000);
});

test("an over-allocation attempt against the charge is rejected even if the receipt has enough unallocated credit", () => {
  const c = charge();
  const receipt = { id: 1, amountFen: 200_000, status: "posted" as const };
  const result = validateAllocation({
    receipt,
    existingReceiptAllocations: [],
    charge: c,
    chargeAdjustments: [],
    existingChargeAllocations: [],
    amountFen: 120_000, // charge only owes 100,000
    asOfDate: "2026-01-10",
  });
  assert.equal(result.ok, false);
});

test("reversing an allocation restores both the charge balance and the receipt's unallocated credit, with linked history retained", () => {
  const c = charge();
  const original = { receiptId: 1, chargeId: 1, amountFen: 100_000 };
  const reversal = { receiptId: 1, chargeId: 1, amountFen: -100_000 };
  const receipt = { id: 1, amountFen: 100_000, status: "posted" as const };

  // Before reversal: fully paid.
  assert.equal(computeChargeBalance(c, [], [original], "2026-02-01").balanceFen, 0);
  // After reversal: both rows retained, balance restored, receipt's credit restored.
  assert.equal(computeChargeBalance(c, [], [original, reversal], "2026-02-01").balanceFen, 100_000);
  assert.equal(computeUnallocatedFen(receipt, [original, reversal]), 100_000);
});

test("deposit refund and deduction reduce the held balance while receipt/reversal history stays linked and additive", () => {
  const transactions = [
    { amountFen: 500_000, transactionDate: "2026-01-05" }, // initial deposit receipt
    { amountFen: -50_000, transactionDate: "2026-06-01" }, // deduction for damage
    { amountFen: -450_000, transactionDate: "2026-12-31" }, // refund of the rest at move-out
  ];
  assert.equal(computeDepositBalance(transactions, "2026-01-31"), 500_000);
  assert.equal(computeDepositBalance(transactions, "2026-07-01"), 450_000);
  assert.equal(computeDepositBalance(transactions, "2027-01-01"), 0);
});

test("monthly statement: opening + new charges + adjustments - receipts applied = closing, and reconciles against a hand-checked reference", () => {
  const jan = charge({ id: 1, serviceStart: "2026-01-01", serviceEnd: "2026-01-31", dueDate: "2026-01-25", amountFen: 100_000 });
  const feb = charge({ id: 2, serviceStart: "2026-02-01", serviceEnd: "2026-02-28", dueDate: "2026-02-25", amountFen: 100_000 });

  const input = {
    charges: [jan, feb],
    adjustments: [{ chargeId: 1, amountFen: -5_000, createdAt: "2026-02-10" }], // a small credit adjustment posted in February
    receipts: [{ id: 1, amountFen: 95_000, status: "posted" as const }],
    allocations: [{ receiptId: 1, chargeId: 1, amountFen: 95_000, createdAt: "2026-02-15" }],
    depositTransactions: [{ amountFen: 300_000, transactionDate: "2026-01-05" }],
  };

  const january = computeMonthlyStatement(input, "2026-01-01", "2026-01-31");
  assert.equal(january.openingReceivableFen, 0);
  assert.equal(january.newChargesFen, 100_000);
  assert.equal(january.closingReceivableFen, 100_000);
  assert.equal(january.depositBalanceFen, 300_000);

  const february = computeMonthlyStatement(input, "2026-02-01", "2026-02-28");
  assert.equal(february.openingReceivableFen, 100_000);
  assert.equal(february.newChargesFen, 100_000);
  assert.equal(february.adjustmentsFen, -5_000);
  assert.equal(february.receiptsAppliedFen, 95_000);
  // 100,000 (opening) + 100,000 (new) - 5,000 (adjustment) - 95,000 (applied) = 100,000
  assert.equal(february.closingReceivableFen, 100_000);
  assert.equal(
    february.closingReceivableFen,
    february.openingReceivableFen + february.newChargesFen + february.adjustmentsFen - february.receiptsAppliedFen,
  );
});
