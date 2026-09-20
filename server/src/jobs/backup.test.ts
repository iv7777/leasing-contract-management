import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRunsToPrune, isWeeklyBackupDue, DAILY_RETENTION_LIMIT } from "./backupRetention.js";

test("selectRunsToPrune keeps everything at or under the limit", () => {
  assert.deepEqual(selectRunsToPrune([1, 2, 3], 30), []);
  assert.deepEqual(selectRunsToPrune(Array.from({ length: 30 }, (_, i) => i + 1), 30), []);
});

test("selectRunsToPrune removes exactly the oldest excess, oldest-first", () => {
  const ids = Array.from({ length: 32 }, (_, i) => i + 1); // 1..32, oldest first
  assert.deepEqual(selectRunsToPrune(ids, 30), [1, 2]);
});

test("selectRunsToPrune handles an empty list", () => {
  assert.deepEqual(selectRunsToPrune([], 30), []);
});

test("a weekly backup is not due until the daily rotation is exactly full", () => {
  assert.equal(isWeeklyBackupDue(0), false);
  assert.equal(isWeeklyBackupDue(DAILY_RETENTION_LIMIT - 1), false);
  assert.equal(isWeeklyBackupDue(DAILY_RETENTION_LIMIT), true);
  assert.equal(isWeeklyBackupDue(DAILY_RETENTION_LIMIT + 5), true);
});
