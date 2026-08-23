/**
 * 02-multi-user-mode / Task 03 — instance settings payload builder (UI helper).
 *
 * TDD: fails before buildInstanceSettingsPayload exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildInstanceSettingsPayload } from "../../src/lib/auth/instanceSettingsPayload.ts";

test("includes multiUserEnabled when provided", () => {
  assert.deepEqual(buildInstanceSettingsPayload(true), { multiUserEnabled: true });
  assert.deepEqual(buildInstanceSettingsPayload(false), { multiUserEnabled: false });
});

test("omits undefined multiUserEnabled", () => {
  assert.deepEqual(buildInstanceSettingsPayload(undefined, "invite-only"), {
    registrationPolicy: "invite-only",
  });
});

test("includes a valid registration policy", () => {
  assert.deepEqual(buildInstanceSettingsPayload(true, "invite-only"), {
    multiUserEnabled: true,
    registrationPolicy: "invite-only",
  });
});

test("drops an invalid registration policy (fail-closed)", () => {
  assert.deepEqual(buildInstanceSettingsPayload(true, "open-public" as never), {
    multiUserEnabled: true,
  });
});
