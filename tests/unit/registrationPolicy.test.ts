/**
 * TDD regression suite for the client-safe registration-policy derivation.
 * Pure function, no DB/server dependencies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRegistrationAllowed, type RegistrationVisibility } from "@/lib/auth/registrationPolicy";

test("isRegistrationAllowed: true only when multi on AND policy != disabled", () => {
  const allow: RegistrationVisibility = {
    multiUserEnabled: true,
    registrationPolicy: "invite-only",
  };
  const disMulti: RegistrationVisibility = {
    multiUserEnabled: false,
    registrationPolicy: "invite-only",
  };
  const disPolicy: RegistrationVisibility = {
    multiUserEnabled: true,
    registrationPolicy: "disabled",
  };
  assert.equal(isRegistrationAllowed(allow), true);
  assert.equal(isRegistrationAllowed(disMulti), false);
  assert.equal(isRegistrationAllowed(disPolicy), false);
});

test("isRegistrationAllowed: null/undefined are not allowed", () => {
  assert.equal(isRegistrationAllowed(null), false);
  assert.equal(isRegistrationAllowed(undefined), false);
});
