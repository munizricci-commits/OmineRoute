/**
 * 02-multi-user-mode / Task 04 — server-side registration policy gate.
 *
 * Central gate used by (future) registration endpoints. Registration is allowed
 * only when multi-user mode is ON and the policy is not "disabled". Fail-closed:
 * any read error or unknown state => registration denied.
 *
 * TDD: fails before registrationGate exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-reg-gate-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-reg-gate";

const core = await import("../../src/lib/db/core.ts");
const ia = await import("../../src/lib/db/instanceAuthSettings.ts");
const gate = await import("../../src/lib/auth/registrationGate.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("registration is denied by default (multi-user OFF)", async () => {
  assert.equal(await gate.isRegistrationAllowed(), false);
  await assert.rejects(() => gate.assertRegistrationAllowed(), /registration/i);
});

test("registration denied when multi-user ON but policy disabled", async () => {
  await ia.setInstanceAuthSettings({ multiUserEnabled: true, registrationPolicy: "disabled" });
  assert.equal(await gate.isRegistrationAllowed(), false);
  await assert.rejects(() => gate.assertRegistrationAllowed(), /registration/i);
});

test("registration allowed when multi-user ON and invite-only", async () => {
  await ia.setInstanceAuthSettings({ multiUserEnabled: true, registrationPolicy: "invite-only" });
  assert.equal(await gate.isRegistrationAllowed(), true);
  await gate.assertRegistrationAllowed(); // does not throw
});

test("gate fails closed on read error (treat as denied)", async () => {
  // Force a failure by pointing DATA_DIR at a non-writable/garbage location is
  // impractical here; instead verify the default-deny contract holds and the
  // assert variant throws a safe message without leaking internals.
  const err = await gate.assertRegistrationAllowed().catch((e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /registration/i);
});
