import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginThrottle } from "./loginThrottle.js";

test("eight failures from one place lock that address for the window, then release", () => {
  const t = new LoginThrottle(1000, 3, 100);
  for (let i = 0; i < 3; i++) {
    assert.equal(t.retryAfterMs("1.1.1.1", "a@x.com", i), 0);
    t.recordFailure("1.1.1.1", "A@x.com", i);
  }
  assert.ok(t.retryAfterMs("1.1.1.1", "a@x.com", 10) > 0);
  assert.equal(t.retryAfterMs("2.2.2.2", "a@x.com", 10), 0); // another place is not locked out
  assert.equal(t.retryAfterMs("1.1.1.1", "a@x.com", 5000), 0); // window passed
});

test("a success clears the count for that source", () => {
  const t = new LoginThrottle(1000, 2, 100);
  t.recordFailure("s", "a@x.com", 0);
  t.recordSuccess("s", "a@x.com");
  t.recordFailure("s", "a@x.com", 1);
  assert.equal(t.retryAfterMs("s", "a@x.com", 2), 0);
});
