import { test } from "node:test";
import assert from "node:assert/strict";
import { isPastTermEnd, dueStatusFromAmendment } from "./contractLifecycle.js";

test("an active contract is still active on its last day and expires the day after", () => {
  assert.equal(isPastTermEnd("active", "2026-10-19", "2026-10-19"), false);
  assert.equal(isPastTermEnd("active", "2026-10-19", "2026-10-20"), true);
});

test("only active contracts expire", () => {
  for (const s of ["draft", "expired", "terminated"] as const) assert.equal(isPastTermEnd(s, "2020-01-01", "2026-10-20"), false);
});

const terminate = JSON.stringify({ contract: { status: "terminated", termEnd: "2026-12-31" } });

test("an amendment's status change waits for its effective date", () => {
  assert.equal(dueStatusFromAmendment(terminate, "2026-12-31", "2026-12-30"), null);
  assert.equal(dueStatusFromAmendment(terminate, "2026-12-31", "2026-12-31"), "terminated");
  assert.equal(dueStatusFromAmendment(terminate, "2026-12-31", "2027-01-05"), "terminated");
});

test("an amendment that doesn't touch the status, or has bad JSON, asks for nothing", () => {
  assert.equal(dueStatusFromAmendment(JSON.stringify({ contract: { termEnd: "2027-01-01" } }), "2026-01-01", "2026-10-20"), null);
  assert.equal(dueStatusFromAmendment("{not json", "2026-01-01", "2026-10-20"), null);
});
