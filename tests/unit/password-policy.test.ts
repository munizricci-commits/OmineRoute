/**
 * 04-registration / Task 04 — password policy evaluation (pure module).
 *
 * TDD: fails before lib/auth/passwordPolicy.ts exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePassword, DEFAULT_PASSWORD_POLICY } from "@/lib/auth/passwordPolicy";

test("accepts a reasonably strong password", () => {
  const res = evaluatePassword("correct horse battery");
  assert.equal(res.valid, true);
  assert.deepEqual(res.errors, []);
});

test("rejects a password shorter than the minimum length", () => {
  const res = evaluatePassword("short");
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test("rejects an empty or whitespace-only password", () => {
  assert.equal(evaluatePassword("").valid, false);
  assert.equal(evaluatePassword("    ").valid, false);
});

test("rejects a password longer than the maximum length", () => {
  const tooLong = "a".repeat(DEFAULT_PASSWORD_POLICY.maxLength + 1);
  const res = evaluatePassword(tooLong);
  assert.equal(res.valid, false);
});

test("rejects common/trivial passwords from the denylist", () => {
  for (const weak of ["password", "12345678", "omniroute", "qwerty123"]) {
    const res = evaluatePassword(weak);
    assert.equal(res.valid, false, `expected '${weak}' to be rejected`);
  }
});

test("rejects a password that is only whitespace-padded trivial value", () => {
  const res = evaluatePassword("  password  ");
  assert.equal(res.valid, false);
});
