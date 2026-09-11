import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReminders, type ContractReminderInput } from "./reminders.js";

function contractInput(overrides: Partial<ContractReminderInput> = {}): ContractReminderInput {
  return {
    contractId: 1,
    referenceNumber: "LC-1",
    status: "active",
    termEnd: "2026-12-31",
    renewalNoticeDays: 90,
    upcomingRateChanges: [],
    depositRequiredFen: null,
    depositWaived: false,
    depositHeldFen: 0,
    chargeBalances: [],
    ...overrides,
  };
}

test("renewal notice fires once inside the notice window and not before or after", () => {
  const c = contractInput({ termEnd: "2026-12-31", renewalNoticeDays: 90 });
  assert.equal(computeReminders([c], "2026-09-01").filter((r) => r.type === "renewal_notice").length, 0); // before window (window opens 2026-10-02)
  assert.equal(computeReminders([c], "2026-11-01").filter((r) => r.type === "renewal_notice").length, 1); // inside window
  assert.equal(computeReminders([c], "2027-01-15").filter((r) => r.type === "renewal_notice").length, 0); // after term end
});

test("upcoming rate change only shows within the lookahead window", () => {
  const c = contractInput({ upcomingRateChanges: [{ effectiveStart: "2026-05-01", pricingStreamLabel: "2F rent" }] });
  assert.equal(computeReminders([c], "2026-04-15").filter((r) => r.type === "rate_change").length, 1); // 16 days out
  assert.equal(computeReminders([c], "2026-01-01").filter((r) => r.type === "rate_change").length, 0); // far in the future
});

test("deposit shortfall fires only when unwaived and held is below required", () => {
  const short = contractInput({ depositRequiredFen: 500_000, depositHeldFen: 400_000 });
  const met = contractInput({ depositRequiredFen: 500_000, depositHeldFen: 500_000 });
  const waived = contractInput({ depositRequiredFen: 500_000, depositHeldFen: 0, depositWaived: true });

  assert.equal(computeReminders([short], "2026-01-01").filter((r) => r.type === "deposit_shortfall").length, 1);
  assert.equal(computeReminders([met], "2026-01-01").filter((r) => r.type === "deposit_shortfall").length, 0);
  assert.equal(computeReminders([waived], "2026-01-01").filter((r) => r.type === "deposit_shortfall").length, 0);
});

test("overdue balance only escalates past the 10-day threshold and stops once settled", () => {
  const barelyOverdue = contractInput({ chargeBalances: [{ chargeId: 1, balanceFen: 1000, dueDate: "2026-01-01", isOverdue: true, daysOverdue: 5 }] });
  const escalated = contractInput({ chargeBalances: [{ chargeId: 1, balanceFen: 1000, dueDate: "2026-01-01", isOverdue: true, daysOverdue: 12 }] });
  const settled = contractInput({ chargeBalances: [{ chargeId: 1, balanceFen: 0, dueDate: "2026-01-01", isOverdue: false, daysOverdue: 0 }] });

  assert.equal(computeReminders([barelyOverdue], "2026-01-13").filter((r) => r.type === "overdue_balance").length, 0);
  assert.equal(computeReminders([escalated], "2026-01-13").filter((r) => r.type === "overdue_balance").length, 1);
  assert.equal(computeReminders([settled], "2026-01-13").filter((r) => r.type === "overdue_balance").length, 0);
});

test("draft and terminated contracts never produce reminders", () => {
  const draft = contractInput({ status: "draft", chargeBalances: [{ chargeId: 1, balanceFen: 1000, dueDate: "2020-01-01", isOverdue: true, daysOverdue: 999 }] });
  assert.equal(computeReminders([draft], "2026-01-01").length, 0);
});
