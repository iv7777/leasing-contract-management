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
    deposit: { state: "none", requiredFen: 0, heldFen: 0, shortfallFen: 0 },
    chargeBalances: [],
    missingReadings: [],
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

test("deposit reminders follow the shared deposit state", () => {
  const short = contractInput({ deposit: { state: "short", requiredFen: 500_000, heldFen: 400_000, shortfallFen: 100_000 } });
  const ok = contractInput({ deposit: { state: "ok", requiredFen: 500_000, heldFen: 500_000, shortfallFen: 0 } });
  const manual = contractInput({ deposit: { state: "manual", requiredFen: 0, heldFen: 0, shortfallFen: 0 } });

  assert.equal(computeReminders([short], "2026-01-01").filter((r) => r.type === "deposit_shortfall").length, 1);
  assert.equal(computeReminders([ok], "2026-01-01").length, 0);
  assert.equal(computeReminders([manual], "2026-01-01").filter((r) => r.type === "deposit_check").length, 1);
});

const bal = (chargeId: number, balanceFen: number, dueDate: string, daysOverdue: number) => ({ chargeId, balanceFen, dueDate, isOverdue: daysOverdue > 0, daysOverdue });

test("overdue shows from the first day past grace — no extra delay — and clears once settled", () => {
  const dayOne = contractInput({ chargeBalances: [bal(1, 1000, "2026-01-01", 1)] });
  const notYet = contractInput({ chargeBalances: [bal(1, 1000, "2026-01-01", 0)] }); // still inside grace
  const settled = contractInput({ chargeBalances: [bal(1, 0, "2026-01-01", 0)] });

  assert.equal(computeReminders([dayOne], "2026-01-07").filter((r) => r.type === "overdue_balance").length, 1);
  assert.equal(computeReminders([notYet], "2026-01-03").filter((r) => r.type === "overdue_balance").length, 0);
  assert.equal(computeReminders([settled], "2026-01-13").filter((r) => r.type === "overdue_balance").length, 0);
});

test("many overdue bills on one contract collapse into a single reminder with totals", () => {
  const c = contractInput({ chargeBalances: [bal(1, 1000, "2026-01-01", 40), bal(2, 2500, "2026-02-01", 9), bal(3, 500, "2026-03-01", 0)] });
  const overdue = computeReminders([c], "2026-03-02").filter((r) => r.type === "overdue_balance");
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].params.count, 2);
  assert.equal(overdue[0].params.balanceFen, 3500);
  assert.equal(overdue[0].params.dueDate, "2026-01-01");
  assert.equal(overdue[0].severity, "critical"); // oldest is 40 days overdue
  const recent = contractInput({ chargeBalances: [bal(1, 1000, "2026-02-01", 9)] });
  assert.equal(computeReminders([recent], "2026-03-02")[0].severity, "warning");
});

test("missing meter readings produce one reminder per contract", () => {
  const c = contractInput({ missingReadings: [{ stream: "Electricity", month: "2026-04" }, { stream: "Electricity", month: "2026-05" }, { stream: "Water", month: "2026-05" }] });
  const r = computeReminders([c], "2026-06-10").filter((x) => x.type === "missing_reading");
  assert.equal(r.length, 1);
  assert.equal(r[0].params.count, 3);
  assert.equal(r[0].params.months, "2026-04, 2026-05");
});

test("reminders are sorted most urgent first", () => {
  const info = contractInput({ contractId: 1, upcomingRateChanges: [{ effectiveStart: "2026-01-10", pricingStreamLabel: "rent" }] });
  const critical = contractInput({ contractId: 2, chargeBalances: [bal(1, 1000, "2025-11-01", 60)] });
  const order = computeReminders([info, critical], "2026-01-02").map((r) => r.severity);
  assert.deepEqual(order, ["critical", "info"]);
});

test("draft and terminated contracts never produce reminders", () => {
  const draft = contractInput({ status: "draft", chargeBalances: [bal(1, 1000, "2020-01-01", 999)] });
  assert.equal(computeReminders([draft], "2026-01-01").length, 0);
});
