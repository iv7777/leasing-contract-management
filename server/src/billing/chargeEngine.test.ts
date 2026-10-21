import { test } from "node:test";
import assert from "node:assert/strict";
import { generateChargeLines, computeDueDate, computeMeteredDueDate, computeEscalatedRate } from "./chargeEngine.js";
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
    usageEntries: [],
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
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "per_sqm", amountOrRate: "30", rateBasis: "per_sqm_per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
      { id: 101, pricingStreamId: 11, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "per_sqm", amountOrRate: "45", rateBasis: "per_sqm_per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
  });

  const { lines } = generateChargeLines(input, "2026-03-01", "2026-03-31");
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
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: "2026-04-15", calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
      { id: 101, pricingStreamId: 10, effectiveStart: "2026-04-16", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "12000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
  });

  // April has 30 days; old rate covers days 1-15 (15 days), new rate covers 16-30 (15 days).
  const { lines } = generateChargeLines(input, "2026-04-01", "2026-04-30");
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
    unit: null,
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
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
      { id: 101, pricingStreamId: 11, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "800", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
    concessions: [
      { pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: "2026-01-31", discountPercentage: "100", reason: "Free rent month" },
    ],
  });

  const { lines } = generateChargeLines(input, "2026-01-01", "2026-01-31");
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
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "10000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
  });
  const a = generateChargeLines(input, "2026-02-01", "2026-02-28").lines;
  const b = generateChargeLines(input, "2026-02-01", "2026-02-28").lines;
  assert.deepEqual(a, b);
});

test("metered stream: charges price-per-unit times the matching usage entry's quantity", () => {
  const input = baseInput({
    pricingStreams: [{ id: 10, feeType: "electricity_base", targetType: "unit" }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "metered", amountOrRate: "1.2", rateBasis: "per_unit", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: "kWh" },
    ],
    usageEntries: [
      { pricingStreamId: 10, serviceStart: "2026-03-01", serviceEnd: "2026-03-31", quantity: "500" },
    ],
  });

  const { lines, skippedMissingUsage } = generateChargeLines(input, "2026-03-01", "2026-03-31");
  assert.equal(skippedMissingUsage.length, 0);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.amountFen, 500 * 1.2 * 100); // 500 kWh * 1.2 yuan = 600 yuan = 60,000 fen
  assert.equal(line.snapshot.subperiods[0].quantity, "500.0000");
  assert.equal(line.snapshot.subperiods[0].unit, "kWh");
});

test("metered stream: skips the stream (does not throw) when no usage entry matches the period", () => {
  const input = baseInput({
    pricingStreams: [{ id: 10, feeType: "electricity_base", targetType: "unit" }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "metered", amountOrRate: "1.2", rateBasis: "per_unit", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: "kWh" },
    ],
    usageEntries: [],
  });

  const { lines, skippedMissingUsage } = generateChargeLines(input, "2026-03-01", "2026-03-31");
  assert.equal(lines.length, 0);
  assert.deepEqual(skippedMissingUsage, [10]);
});

test("computeDueDate: 25th of the prior month, with short-month fallback", () => {
  assert.equal(computeDueDate("2026-04-01", { dueDay: 25, dueMonthOffset: -1 }), "2026-03-25");
  // dueDay 31 in a target month with only 28/30 days falls back to last day.
  assert.equal(computeDueDate("2026-03-01", { dueDay: 31, dueMonthOffset: -1 }), "2026-02-28");
});

test("metered charges are billed in arrears: due the month after the usage month", () => {
  // Rent due the 1st of the service month; electricity for March can only be
  // known in April, so it is due April 1 — not March 1.
  const rules = { dueDay: 1, dueMonthOffset: 0 };
  assert.equal(computeMeteredDueDate("2026-03-01", rules), "2026-04-01");
  // Rent billed in advance (offset -1) still leaves metered due next month.
  assert.equal(computeMeteredDueDate("2026-03-01", { dueDay: 25, dueMonthOffset: -1 }), "2026-04-25");
  // A contract that already bills rent in arrears keeps its own offset.
  assert.equal(computeMeteredDueDate("2026-03-01", { dueDay: 10, dueMonthOffset: 2 }), "2026-05-10");
});

test("metered line gets the arrears due date, and a missing reading reports it", () => {
  const rate: RateScheduleInput = { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "metered", amountOrRate: "1", rateBasis: "per_unit", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: "kWh" };
  const streams = [{ id: 10, feeType: "electricity_base", targetType: "unit" as const }];
  const rules = { dueDay: 1, dueMonthOffset: 0 };

  const withUsage = generateChargeLines(
    baseInput({ billingRules: rules, pricingStreams: streams, rateSchedule: [rate], usageEntries: [{ pricingStreamId: 10, serviceStart: "2026-03-01", serviceEnd: "2026-03-31", quantity: "100" }] }),
    "2026-03-01",
    "2026-03-31",
  );
  assert.equal(withUsage.lines[0].dueDate, "2026-04-01");

  const without = generateChargeLines(baseInput({ billingRules: rules, pricingStreams: streams, rateSchedule: [rate] }), "2026-03-01", "2026-03-31");
  assert.deepEqual(without.missingUsage, [{ pricingStreamId: 10, dueDate: "2026-04-01" }]);
});

// ---------------------------------------------------------------------------
// Usage service fee: a second line on the same reading
// ---------------------------------------------------------------------------

const meteredRate = (price: string): RateScheduleInput => ({ id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "metered", amountOrRate: price, rateBasis: "per_unit", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: "kWh" });
const feeRate = (method: "usage_fee_per_unit" | "usage_fee_percent", value: string, linked: number | null = 10): RateScheduleInput => ({
  id: 101,
  pricingStreamId: 11,
  effectiveStart: "2026-01-01",
  effectiveEnd: null,
  calculationMethod: method,
  amountOrRate: value,
  rateBasis: method === "usage_fee_per_unit" ? "per_unit" : "percent_of_usage",
  escalationBase: null,
  escalationPercentage: null,
  escalationIntervalMonths: null,
  unit: null,
  linkedStreamId: linked,
});
const feeInput = (fee: RateScheduleInput, withUsage = true, concessions: ChargeEngineInput["concessions"] = []) =>
  baseInput({
    pricingStreams: [
      { id: 10, feeType: "electricity_base", targetType: "contract" },
      { id: 11, feeType: "other", targetType: "contract" },
    ],
    rateSchedule: [meteredRate("1"), fee],
    concessions,
    usageEntries: withUsage ? [{ pricingStreamId: 10, serviceStart: "2026-03-01", serviceEnd: "2026-03-31", quantity: "1000" }] : [],
  });

test("usage fee per unit: 1000 kWh at 1.00 plus 0.10 per kWh bills 1000.00 and 100.00 as two lines", () => {
  const { lines } = generateChargeLines(feeInput(feeRate("usage_fee_per_unit", "0.1")), "2026-03-01", "2026-03-31");
  assert.equal(lines.find((l) => l.pricingStreamId === 10)!.amountFen, 100_000);
  assert.equal(lines.find((l) => l.pricingStreamId === 11)!.amountFen, 10_000);
  assert.equal(lines.length, 2);
});

test("usage fee percent: 10% of the 1000.00 usage charge is 100.00", () => {
  const { lines } = generateChargeLines(feeInput(feeRate("usage_fee_percent", "10")), "2026-03-01", "2026-03-31");
  assert.equal(lines.find((l) => l.pricingStreamId === 11)!.amountFen, 10_000);
});

test("usage fee: no reading means no fee line, and the missing reading is reported once (for the metered item)", () => {
  const r = generateChargeLines(feeInput(feeRate("usage_fee_percent", "10"), false), "2026-03-01", "2026-03-31");
  assert.equal(r.lines.length, 0);
  assert.deepEqual(r.skippedMissingUsage, [10]);
  assert.equal(r.missingUsage.length, 1);
});

test("usage fee percent is taken before concessions, and its own concession applies once", () => {
  const concessions = [{ pricingStreamId: 11, effectiveStart: "2026-03-01", effectiveEnd: "2026-03-31", discountPercentage: "50" }];
  const { lines } = generateChargeLines(feeInput(feeRate("usage_fee_percent", "10"), true, concessions), "2026-03-01", "2026-03-31");
  assert.equal(lines.find((l) => l.pricingStreamId === 11)!.amountFen, 5_000); // 100.00 less 50%
});

test("a usage fee that isn't linked to a metered item is a configuration error, not a silent zero", () => {
  assert.throws(() => generateChargeLines(feeInput(feeRate("usage_fee_per_unit", "0.1", null)), "2026-03-01", "2026-03-31"), /not linked to a metered item/);
});

test("usage fee: while the followed item has no price yet, there is no fee line (and no error)", () => {
  const input = feeInput(feeRate("usage_fee_percent", "10"));
  input.rateSchedule = [{ ...meteredRate("1"), effectiveStart: "2026-04-01" }, feeRate("usage_fee_percent", "10")];
  const { lines } = generateChargeLines(input, "2026-03-01", "2026-03-31");
  assert.equal(lines.length, 0);
});

// ---------------------------------------------------------------------------
// Usage-based prices that start part-way through a month
// ---------------------------------------------------------------------------

test("a metered price and its service fee that start mid-month bill nothing for that month (and never error or bill a prorated flat amount)", () => {
  const input = baseInput({
    pricingStreams: [
      { id: 10, feeType: "electricity_base", targetType: "contract" },
      { id: 11, feeType: "other", targetType: "contract" },
    ],
    rateSchedule: [
      { ...meteredRate("1"), effectiveStart: "2026-10-19", rateBasis: "per_month" },
      { ...feeRate("usage_fee_per_unit", "0.1"), effectiveStart: "2026-10-19" },
    ],
    usageEntries: [{ pricingStreamId: 10, serviceStart: "2026-10-01", serviceEnd: "2026-10-31", quantity: "500" }],
  });
  const r = generateChargeLines(input, "2026-10-01", "2026-10-31");
  assert.equal(r.lines.length, 0);
  assert.equal(r.missingUsage.length, 0);
  // and the first full month after the start is billed normally
  input.usageEntries = [{ pricingStreamId: 10, serviceStart: "2026-11-01", serviceEnd: "2026-11-30", quantity: "500" }];
  const nov = generateChargeLines(input, "2026-11-01", "2026-11-30");
  assert.equal(nov.lines.find((l) => l.pricingStreamId === 10)!.amountFen, 50_000);
  assert.equal(nov.lines.find((l) => l.pricingStreamId === 11)!.amountFen, 5_000);
});

test("billing stops on the contract's last day: a contract ending on the 10th pays 10 days of that month", () => {
  const input = baseInput({
    billingStart: "2027-01-15",
    billingEnd: "2028-03-10",
    contractUnits: [{ id: 1, effectiveStart: "2027-01-15", effectiveEnd: null, contractedAreaSqm: "100" }],
    pricingStreams: [{ id: 10, feeType: "rent", targetType: "unit" }],
    pricingStreamUnits: [{ pricingStreamId: 10, contractUnitId: 1 }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2027-01-15", effectiveEnd: null, calculationMethod: "per_sqm", amountOrRate: "10", rateBasis: "per_sqm_per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
  });
  const last = generateChargeLines(input, "2028-03-01", "2028-03-31").lines[0];
  assert.equal(last.amountFen, Math.round((1000 * 10) / 31 * 100)); // 10 of 31 days
  assert.equal(generateChargeLines(input, "2028-04-01", "2028-04-30").lines.length, 0);
  assert.equal(generateChargeLines(input, "2026-12-01", "2026-12-31").lines.length, 0);
  assert.equal(generateChargeLines(input, "2027-02-01", "2027-02-28").lines[0].amountFen, 100_000);
});

test("an earlier termination date caps billing mid-month and drops later months", () => {
  const input = baseInput({
    billingEnd: "2026-11-30",
    pricingStreams: [{ id: 10, feeType: "management", targetType: "contract" }],
    rateSchedule: [
      { id: 100, pricingStreamId: 10, effectiveStart: "2026-01-01", effectiveEnd: null, calculationMethod: "flat", amountOrRate: "3000", rateBasis: "per_month", escalationBase: null, escalationPercentage: null, escalationIntervalMonths: null, unit: null },
    ],
  });
  assert.equal(generateChargeLines(input, "2026-11-01", "2026-11-30").lines[0].amountFen, 300_000);
  assert.equal(generateChargeLines(input, "2026-12-01", "2026-12-31").lines.length, 0);
});
