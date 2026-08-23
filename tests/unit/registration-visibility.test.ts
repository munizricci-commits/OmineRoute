/**
 * 02-multi-user-mode / Task 05 — show/hide Register from server-backed policy.
 *
 * TDD: fails before deriveRegistrationAllowed exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { deriveRegistrationAllowed } from "../../src/lib/auth/registrationVisibility.ts";

test("hidden when settings are null/undefined", () => {
  assert.equal(deriveRegistrationAllowed(null), false);
  assert.equal(deriveRegistrationAllowed(undefined), false);
});

test("hidden when multi-user mode is OFF", () => {
  assert.equal(
    deriveRegistrationAllowed({ multiUserEnabled: false, registrationPolicy: "disabled" }),
    false
  );
});

test("hidden when policy is disabled even if multi-user ON", () => {
  assert.equal(
    deriveRegistrationAllowed({ multiUserEnabled: true, registrationPolicy: "disabled" }),
    false
  );
});

test("shown when multi-user ON and policy invite-only", () => {
  assert.equal(
    deriveRegistrationAllowed({ multiUserEnabled: true, registrationPolicy: "invite-only" }),
    true
  );
});
