/**
 * 04-registration / Task 01 — explicit registration policy persistence.
 *
 * TDD: fails before instanceAuthSettings exposes registration_policy behavior,
 * then passes (policy already wired in Phase 02; this locks the contract).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getInstanceAuthSettings,
  setInstanceAuthSettings,
  type RegistrationPolicy,
} from "@/lib/db/instanceAuthSettings";
import { core } from "../../src/lib/db/core.ts";

test("fresh database defaults registration policy to disabled", async () => {
  const settings = await getInstanceAuthSettings();
  assert.equal(settings.registrationPolicy, "disabled");
  assert.equal(settings.multiUserEnabled, false);
});

test("registration policy can be persisted as invite-only and read back", async () => {
  const saved = await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  assert.equal(saved.registrationPolicy, "invite-only");
  const read = await getInstanceAuthSettings();
  assert.equal(read.registrationPolicy, "invite-only");
});

test("invalid registration policy is rejected (fail-closed)", async () => {
  await assert.rejects(() =>
    setInstanceAuthSettings({ registrationPolicy: "open" as RegistrationPolicy })
  );
});
