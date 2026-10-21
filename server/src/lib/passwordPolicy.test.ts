import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordError } from "./passwordPolicy.js";

test("password policy", () => {
  assert.ok(passwordError("short1"));
  assert.ok(passwordError("onlyletterslong"));
  assert.ok(passwordError("12345678901"));
  assert.ok(passwordError("Password123"));
  assert.ok(passwordError("hongba2026xyz", "hongba@yahoo.com"));
  assert.equal(passwordError("Zz-Test-Passw0rd!", "x@example.com"), null);
});
