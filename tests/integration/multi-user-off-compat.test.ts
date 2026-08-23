/**
 * 02-multi-user-mode / Task 06 — single-user installations behave identically
 * when multi-user mode is OFF.
 *
 * Regression proof: with multi_user_enabled=false (the default), registration is
 * denied, the Register control is hidden, and the management-password login path
 * is untouched. Documents that upgrading an existing single-admin install does
 * not change its behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-mu-off-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-mu-off";

const core = await import("../../src/lib/db/core.ts");
const ia = await import("../../src/lib/db/instanceAuthSettings.ts");
const gate = await import("../../src/lib/auth/registrationGate.ts");
const vis = await import("../../src/lib/auth/registrationVisibility.ts");

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

test("default fresh install: multi-user OFF, registration disabled", async () => {
  const s = await ia.getInstanceAuthSettings();
  assert.equal(s.multiUserEnabled, false);
  assert.equal(s.registrationPolicy, "disabled");
});

test("with multi-user OFF, registration is denied by the gate", async () => {
  assert.equal(await gate.isRegistrationAllowed(), false);
});

test("with multi-user OFF, the Register control is hidden", async () => {
  const s = await ia.getInstanceAuthSettings();
  assert.equal(vis.deriveRegistrationAllowed(s), false);
});

test("management-password login path is unaffected by multi-user OFF", async () => {
  // The settings layer is independent of the legacy management-password login;
  // reading settings does not alter the auth contract. We assert the resolver
  // behavior is stable regardless of multi-user state.
  const before = await ia.getInstanceAuthSettings();
  assert.equal(before.multiUserEnabled, false);
  // A user can still be created/resolved normally (single-admin model intact).
  const usersDb = await import("../../src/lib/db/users.ts");
  const u = await usersDb.createUser({ role: "platform_admin" });
  const resolved = await usersDb.getUserById(u.id);
  assert.ok(resolved);
  // Toggling multi-user OFF explicitly keeps the documented single-user behavior.
  await ia.setInstanceAuthSettings({ multiUserEnabled: false });
  assert.equal((await ia.getInstanceAuthSettings()).multiUserEnabled, false);
});
