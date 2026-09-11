import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLatePenalty } from "./latePenalty.js";

test("computes a flat daily-rate penalty on the outstanding balance", () => {
  // 0.5 permille/day = 0.05%/day, on 1,000,000 fen for 10 days = 5,000 fen
  const penalty = computeLatePenalty(1_000_000, 10, { enabled: true, dailyRatePermille: "0.5", capFen: null });
  assert.equal(penalty, 5_000);
});

test("caps the penalty at the configured maximum", () => {
  const penalty = computeLatePenalty(1_000_000, 200, { enabled: true, dailyRatePermille: "0.5", capFen: 50_000 });
  assert.equal(penalty, 50_000);
});

test("returns zero when disabled, not yet overdue, or the balance is already settled", () => {
  assert.equal(computeLatePenalty(1_000_000, 10, { enabled: false, dailyRatePermille: "0.5", capFen: null }), 0);
  assert.equal(computeLatePenalty(1_000_000, 0, { enabled: true, dailyRatePermille: "0.5", capFen: null }), 0);
  assert.equal(computeLatePenalty(0, 10, { enabled: true, dailyRatePermille: "0.5", capFen: null }), 0);
});
