import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDepositStatus, type DepositTermInput } from "./depositStatus.js";

const fixed = (id: number, effectiveStart: string, fixedAmountFen: number, over: Partial<DepositTermInput> = {}): DepositTermInput => ({
  id,
  effectiveStart,
  requirementType: "fixed",
  fixedAmountFen,
  formulaBasis: null,
  waiverMet: null,
  dueDate: null,
  ...over,
});
const TODAY = "2026-10-18";

test("a single fixed deposit: short until enough is held", () => {
  const s = computeDepositStatus([fixed(1, "2026-01-01", 6_000_000)], 4_000_000, TODAY);
  assert.equal(s.requiredFen, 6_000_000);
  assert.equal(s.shortfallFen, 2_000_000);
  assert.equal(s.state, "short");
  assert.equal(computeDepositStatus([fixed(1, "2026-01-01", 6_000_000)], 6_000_000, TODAY).state, "ok");
});

test("several deposit terms add up (original plus space added later)", () => {
  const terms = [fixed(1, "2026-01-01", 6_000_000), fixed(2, "2026-06-01", 2_000_000)];
  const s = computeDepositStatus(terms, 6_000_000, TODAY);
  assert.equal(s.requiredFen, 8_000_000);
  assert.equal(s.shortfallFen, 2_000_000);
});

test("a waived term counts for nothing, and a term not yet effective or due is ignored", () => {
  const terms = [
    fixed(1, "2026-01-01", 6_000_000),
    fixed(2, "2026-02-01", 2_000_000, { waiverMet: true }),
    fixed(3, "2027-01-01", 5_000_000), // future
    fixed(4, "2026-03-01", 1_000_000, { dueDate: "2026-12-01" }), // effective but not due yet
  ];
  const s = computeDepositStatus(terms, 6_000_000, TODAY);
  assert.equal(s.requiredFen, 6_000_000);
  assert.equal(s.waivedFen, 2_000_000);
  assert.equal(s.shortfallFen, 0);
  assert.equal(s.state, "ok");
});

test("a formula term can't be computed, so it asks for a manual check unless waived", () => {
  const formula: DepositTermInput = { id: 1, effectiveStart: "2026-01-01", requirementType: "formula", fixedAmountFen: null, formulaBasis: "3 months' rent", waiverMet: null, dueDate: null };
  assert.equal(computeDepositStatus([formula], 0, TODAY).state, "manual");
  assert.equal(computeDepositStatus([{ ...formula, waiverMet: true }], 0, TODAY).state, "ok");
});

test("no terms means nothing to track", () => {
  assert.equal(computeDepositStatus([], 0, TODAY).state, "none");
});
