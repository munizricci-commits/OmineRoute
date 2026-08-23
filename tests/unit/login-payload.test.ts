/**
 * 01-admin-identity / Task 05 — login UI sends a login identifier with password.
 *
 * TDD: fails before buildLoginPayload exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildLoginPayload } from "../../src/lib/auth/loginPayload.ts";

test("buildLoginPayload includes password and login when provided", () => {
  const p = buildLoginPayload("secret", "admin");
  assert.equal(p.password, "secret");
  assert.equal(p.login, "admin");
});

test("buildLoginPayload trims whitespace around login", () => {
  const p = buildLoginPayload("secret", "  Admin  ");
  assert.equal(p.login, "Admin");
});

test("buildLoginPayload omits login when empty/whitespace (legacy session)", () => {
  assert.equal(buildLoginPayload("secret").login, undefined);
  assert.equal(buildLoginPayload("secret", "").login, undefined);
  assert.equal(buildLoginPayload("secret", "   ").login, undefined);
});

test("buildLoginPayload always carries the password", () => {
  const p = buildLoginPayload("secret", undefined);
  assert.deepEqual(p, { password: "secret" });
});
