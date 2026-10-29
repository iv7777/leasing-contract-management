import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAmendment } from "./amendmentSummary.js";

test("an amendment with unreadable changes summarizes to nothing", () => {
  const a = { id: 1, contractId: 999999, type: "rate_change", reason: "x", effectiveDate: "2026-01-01", baseContractVersion: 1, changesJson: "not json", supportingDocumentId: null, status: "draft", createdBy: null, submittedBy: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reviewReason: null, createdAt: "" } as never;
  assert.deepEqual(summarizeAmendment(a), []);
});
