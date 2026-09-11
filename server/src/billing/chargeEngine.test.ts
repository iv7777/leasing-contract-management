import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChargeLines, computeDueDate, computeEscalatedRate } from "./chargeEngine.js";
import type { ChargeEngineInput, RateScheduleInput } from "./types.js";

const billingRules = { dueDay: 25, dueMonthOffset: -1 };

function baseInput(overrides: Partial<ChargeEngineInput> = {}): ChargeEngineInput {
  return {
    contractUnits: [],
    pricingStreams: [],
    pricingStreamUnits: [],
    rateSchedule: [],
    concessions: [],
    billingRules,
    ...overrides,
  };
}

test("two floors with different per-sqm rates produce separate correct lines and a correct combined total", () => {
  const input = baseInput({
    contractUnits: [
      { id: 1, effectiveStart: "2026-01-01", effectiveEnd: null, contractedAreaSqm: "500" },
      { id: 2, effectiveStart: "2026-01-01", effectiveEnd: null, contractedAreaSqm: "300" },
    ],
    pricingStreams: [
      { id: 10, feeType: "rent", targetType: "unit" },
      { id: 11, feeType: "rent", targetType: "unit" },
    ],
    pricingStreamUnits: [
      { pricingStreamId: 10, contractUnitId: 1 },
      { pricingStreamId: 11, contractUnitId: 2 },
    ],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "per_sqm", amountOrRate: "30", rateBasis: "per_sqm_per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
      { id: 101, pricingStreamId: 11, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "per_sqm", amountOrRate: "45", rateBasis: "per_sqm_per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
    ],
  });

  const lines = generateChargeLines(input, "2026-03-01", "2026-03-31");
  assert.equal(lines.length, 2);

  const floor1 = lines.find((l) => l.pricingStreamId === 10)!;
  const floor2 = lines.find((l) => l.pricingStreamId === 11)!;
  assert.equal(floor1.amountFen, 500 * 30 * 100); // 500 sqm * 30 yuan = 15000 yuan = 1,500,000 fen
  assert.equal(floor2.amountFen, 300 * 45 * 100); // 13500 yuan = 1,350,000 fen

  const combined = floor1.amountFen + floor2.amountFen;
  assert.equal(combined, 2_850_000);
});

test("mid-month rent increase splits and prorates correctly at the effective date", () => {
  const input = baseInput({
    contractUnits: [{ id: 1, effectiveStart: "2026-01-01", effectiveEnd: null, contractedAreaSqm: "100" }],
    pricingStreams: [{ id: 10, feeType: "rent", targetType: "unit" }],
    pricingStreamUnits: [{ pricingStreamId: 10, contractUnitId: 1 }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: "2026-04-15", calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
      { id: 101, pricingStreamId: 10, effectiveStart: "2026-04-16", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "12000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
    ],
  });

  // April has 30 days; old rate covers days 1-15 (15 days), new rate covers 16-30 (15 days).
  const lines = generateChargeLines(input, "2026-04-01", "2026-04-30");
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.snapshot.subperiods.length, 2);
  assert.equal(line.snapshot.subperiods[0].start, "2026-04-01");
  assert.equal(line.snapshot.subperiods[0].end, "2026-04-15");
  assert.equal(line.snapshot.subperiods[1].start, "2026-04-16");
  assert.equal(line.snapshot.subperiods[1].end, "2026-04-30");

  // 10000 * 15/30 + 12000 * 15/30 = 5000 + 6000 = 11000 yuan = 1,100,000 fen
  assert.equal(line.amountFen, 1_100_000);
});

test("percentage escalation compounds correctly at each interval and rounds to yuan cents per tier", () => {
  const rate: RateScheduleInput = {
    id: 200,
    pricingStreamId: 10,
    effectiveStart: "2024-01-01",
    effectiveEnd: null,
    calculationMethod: "percentage_escalation",
    amountOrRate: "10000",
    rateBasis: "per_month",
    escalationBase: "initial",
    escalationPercentage: "5",
    escalationIntervalMonths: 12,
  };

  assert.equal(computeEscalatedRate(rate, "2024-06-01").toFixed(2), "10000.00"); // year 1, no tier yet
  assert.equal(computeEscalatedRate(rate, "2025-01-01").toFixed(2), "10500.00"); // 1 tier: 10000*1.05
  assert.equal(computeEscalatedRate(rate, "2026-01-01").toFixed(2), "11025.00"); // 2 tiers: 10500*1.05
});

test("free rent waives rent but management fee remains payable", () => {
  const input = baseInput({
    contractUnits: [{ id: 1, effectiveStart: "2026-01-01", effectiveEnd: null, contractedAreaSqm: "100" }],
    pricingStreams: [
      { id: 10, feeType: "rent", targetType: "unit" },
      { id: 11, feeType: "management", targetType: "unit" },
    ],
    pricingStreamUnits: [
      { pricingStreamId: 10, contractUnitId: 1 },
      { pricingStreamId: 11, contractUnitId: 1 },
    ],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
      { id: 101, pricingStreamId: 11, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "800", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
    ],
    concessions: [
      { pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: "2026-01-31", discountPercentage: "100", reason: "Free rent month" },
    ],
  });

  const lines = generateChargeLines(input, "2026-01-01", "2026-01-31");
  const rentLine = lines.find((l) => l.pricingStreamId === 10)!;
  const mgmtLine = lines.find((l) => l.pricingStreamId === 11)!;

  assert.equal(rentLine.amountFen, 0);
  assert.equal(mgmtLine.amountFen, 800 * 100);
});

test("repeated generation for the same period is idempotent at the data level (same inputs -> same deterministic output)", () => {
  const input = baseInput({
    contractUnits: [{ id: 1, effectiveStart: "2026-01-01", effectiveEnd: null, contractedAreaSqm: "100" }],
    pricingStreams: [{ id: 10, feeType: "rent", targetType: "unit" }],
    pricingStreamUnits: [{ pricingStreamId: 10, contractUnitId: 1 }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null },
    ],
  });
  const a = generateChargeLines(input, "2026-02-01", "2026-02-28");
  const b = generateChargeLines(input, "2026-02-01", "2026-02-28");
  assert.deepEqual(a, b);
});

test("computeDueDate: 25th of the prior month, with short-month fallback", () => {
  assert.equal(computeDueDate("2026-04-01", { dueDay: 25, dueMonthOffset: -1 }), "2026-03-25");
  // dueDay 31 in a target month with only 28/30 days falls back to last day.
  assert.equal(computeDueDate("2026-03-01", { dueDay: 31, dueMonthOffset: -1 }), "2026-02-28");
});
