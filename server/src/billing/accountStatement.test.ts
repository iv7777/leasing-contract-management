import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAccountStatement, type StatementInput } from "./accountStatement.js";

const ch = (id: number, stream: number, due: string, amount: number, extra: object = {}) => ({
  id, pricingStreamId: stream, feeType: stream === 1 ? "rent" : "electricity", serviceStart: due, serviceEnd: due, dueDate: due, amountFen: amount,
  status: "posted" as const, broughtForward: false, ...extra,
});

const input: StatementInput = {
  charges: [ch(1, 1, "2026-01-01", 100_000), ch(2, 2, "2026-01-05", 20_000), ch(3, 1, "2026-02-01", 100_000), ch(4, 1, "2026-02-01", 5_000, { status: "voided" })],
  adjustments: [{ id: 1, chargeId: 3, amountFen: -10_000, reason: "discount", date: "2026-02-10" }],
  receipts: [
    { id: 1, receivedDate: "2026-01-10", amountFen: 120_000, paymentMethod: "cash", externalReference: null, status: "posted", removed: false },
    { id: 2, receivedDate: "2026-02-15", amountFen: 50_000, paymentMethod: "cash", externalReference: null, status: "posted", removed: false },
    { id: 3, receivedDate: "2026-02-20", amountFen: 999, paymentMethod: "cash", externalReference: null, status: "reversed", removed: true },
  ],
  allocations: [
    { receiptId: 1, chargeId: 1, amountFen: 100_000, date: "2026-01-10" },
    { receiptId: 1, chargeId: 2, amountFen: 20_000, date: "2026-01-10" },
    { receiptId: 2, chargeId: 3, amountFen: 40_000, date: "2026-02-15" },
  ],
};

test("the whole account: opening, movements and closing add up, with a running balance", () => {
  const s = buildAccountStatement(input, { from: null, to: null });
  assert.equal(s.openingFen, 0);
  assert.equal(s.chargesFen, 220_000);
  assert.equal(s.adjustmentsFen, -10_000);
  assert.equal(s.paymentsFen, 170_000);
  assert.equal(s.closingFen, 40_000);
  assert.equal(s.lines[s.lines.length - 1].balanceFen, 40_000);
  // voided bill and removed payment are left out unless asked for
  assert.equal(s.lines.some((l) => l.muted), false);
  assert.equal(s.unallocatedFen, 10_000);
});

test("a period starts from what was owed the day before", () => {
  const s = buildAccountStatement(input, { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(s.openingFen, 0); // January was fully paid
  assert.equal(s.chargesFen, 100_000);
  assert.equal(s.closingFen, 40_000);
  assert.equal(s.openingFen + s.chargesFen + s.adjustmentsFen - s.paymentsFen, s.closingFen);
});

test("a charge is dated by its due date, not its service start", () => {
  const s = buildAccountStatement({ ...input, charges: [ch(9, 1, "2026-04-01", 7_000, { serviceStart: "2026-03-01", serviceEnd: "2026-03-31" })], adjustments: [], receipts: [], allocations: [] }, { from: "2026-03-01", to: "2026-03-31" });
  assert.equal(s.chargesFen, 0);
});

test("voided and removed entries show as records only when asked for, and count for nothing", () => {
  const s = buildAccountStatement(input, { from: null, to: null, includeMuted: true });
  assert.equal(s.lines.filter((l) => l.muted).length, 2);
  assert.equal(s.closingFen, 40_000);
  assert.ok(s.lines.filter((l) => l.muted).every((l) => l.balanceFen === null));
});

test("one item: its bills, adjustments and the part of payments applied to it", () => {
  const s = buildAccountStatement(input, { from: null, to: null, pricingStreamId: 2 });
  assert.equal(s.chargesFen, 20_000);
  assert.equal(s.paymentsFen, 20_000);
  assert.equal(s.closingFen, 0);
  assert.equal(s.unallocatedFen, 0);
});

test("a payment received but not yet applied is a credit against the account", () => {
  const s = buildAccountStatement({ ...input, allocations: [] }, { from: null, to: "2026-01-31" });
  assert.equal(s.closingFen, 120_000 - 120_000);
  assert.equal(s.unallocatedFen, 120_000);
});
