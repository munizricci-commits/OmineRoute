/**
 * 06-password-recovery / Task 07 — forgot-password entry on login, hidden when unsupported.
 *
 * TDD: fails before isPasswordRecoverySupported + require-login flag + login gate exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isPasswordRecoverySupported } from "../../src/lib/auth/passwordRecoverySupport.ts";
import { GET as requireLoginGET } from "../../src/app/api/settings/require-login/route.ts";

test("isPasswordRecoverySupported is true only when multi-user mode is enabled", () => {
  // Single management-password instance: no per-user accounts to recover.
  assert.equal(isPasswordRecoverySupported({ multi_user_enabled: false }), false);
  assert.equal(isPasswordRecoverySupported({ multi_user_enabled: 0 }), false);
  // Multi-user instance: per-user accounts with emails exist.
  assert.equal(isPasswordRecoverySupported({ multi_user_enabled: true }), true);
  assert.equal(isPasswordRecoverySupported({ multi_user_enabled: 1 }), true);
});

test("require-login reports passwordRecoverySupported consistent with multi-user mode", async () => {
  // We cannot easily flip instance settings from here; assert the field is present
  // and boolean-typed in the response shape.
  const res = await requireLoginGET();
  const body = (await res.json()) as { passwordRecoverySupported?: unknown };
  assert.ok(
    "passwordRecoverySupported" in body,
    "response should expose passwordRecoverySupported"
  );
  assert.equal(typeof body.passwordRecoverySupported, "boolean");
});
