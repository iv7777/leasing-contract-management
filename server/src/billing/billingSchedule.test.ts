import { test } from "node:test";
import assert from "node:assert/strict";
import { periodsToConsider, monthEndOf, monthStartOf } from "./billingSchedule.js";

const starts = (ps: { periodStart: string }[]) => ps.map((p) => p.periodStart);

test("monthStartOf / monthEndOf handle short months and leap years", () => {
  assert.equal(monthStartOf("2026-02-17"), "2026-02-01");
  assert.equal(monthEndOf("2026-02-17"), "2026-02-28");
  assert.equal(monthEndOf("2028-02-01"), "2028-02-29");
});

test("lease running since day one: every month from the first through the cutoff month", () => {
  const ps = periodsToConsider("2026-01-15", "2027-12-31", { dueMonthOffset: 0 }, "2026-04-30");
  assert.deepEqual(starts(ps), ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
  assert.equal(ps[0].periodEnd, "2026-01-31");
});

test("rent billed in advance also considers the following month", () => {
  // Due the 25th of the prior month: May's rent falls due in April, so at an
  // April cutoff May is already a candidate.
  const ps = periodsToConsider("2026-01-01", "2027-12-31", { dueMonthOffset: -1 }, "2026-04-30");
  assert.deepEqual(starts(ps).slice(-2), ["2026-04-01", "2026-05-01"]);
});

test("never goes past the lease end", () => {
  const ps = periodsToConsider("2026-01-01", "2026-03-15", { dueMonthOffset: 0 }, "2026-12-31");
  assert.deepEqual(starts(ps), ["2026-01-01", "2026-02-01", "2026-03-01"]);
});

test("a lease that has not started yet has no candidates", () => {
  assert.deepEqual(periodsToConsider("2026-09-01", "2027-08-31", { dueMonthOffset: 0 }, "2026-06-30"), []);
});
