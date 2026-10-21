import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditEntry, editWindowEnd, withinEditWindow } from "./editWindow.js";

const T0 = "2026-10-21T08:00:00.000Z";
const at = (hours: number) => new Date(T0).getTime() + hours * 3600_000;

test("the window is 24 hours from saving", () => {
  assert.equal(editWindowEnd(T0), "2026-10-22T08:00:00.000Z");
  assert.equal(withinEditWindow(T0, at(23.9)), true);
  assert.equal(withinEditWindow(T0, at(24)), false);
});

test("the author and any admin can edit inside the window; others and late edits cannot", () => {
  assert.equal(canEditEntry({ id: 5, role: "collector" }, 5, T0, at(1)), true);
  assert.equal(canEditEntry({ id: 1, role: "admin" }, 5, T0, at(1)), true);
  assert.equal(canEditEntry({ id: 6, role: "manager" }, 5, T0, at(1)), false);
  assert.equal(canEditEntry({ id: 5, role: "collector" }, 5, T0, at(30)), false);
  assert.equal(canEditEntry({ id: 1, role: "admin" }, 5, T0, at(30)), false);
});
