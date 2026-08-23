/**
 * 02-multi-user-mode / Task 01 — persisted instance auth settings.
 *
 * Singleton row holding instance-wide authentication configuration. Multi-user
 * mode defaults to OFF; registration defaults to disabled. TDD: fails before the
 * module/migration exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-instance-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-instance-auth";

const core = await import("../../src/lib/db/core.ts");
const ia = await import("../../src/lib/db/instanceAuthSettings.ts");

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

test("default settings: multi-user OFF, registration disabled", async () => {
  const s = await ia.getInstanceAuthSettings();
  assert.equal(s.multiUserEnabled, false);
  assert.equal(s.registrationPolicy, "disabled");
});

test("setInstanceAuthSettings persists multi-user ON + invite-only", async () => {
  const updated = await ia.setInstanceAuthSettings({
    multiUserEnabled: true,
    registrationPolicy: "invite-only",
  });
  assert.equal(updated.multiUserEnabled, true);
  assert.equal(updated.registrationPolicy, "invite-only");

  const refetched = await ia.getInstanceAuthSettings();
  assert.equal(refetched.multiUserEnabled, true);
  assert.equal(refetched.registrationPolicy, "invite-only");
});

test("setInstanceAuthSettings rejects an unknown registration policy", async () => {
  await assert.rejects(
    () => ia.setInstanceAuthSettings({ registrationPolicy: "open-public" as never }),
    /registration policy/i
  );
  // unchanged
  const s = await ia.getInstanceAuthSettings();
  assert.equal(s.registrationPolicy, "disabled");
});

test("multi-user OFF is the stable default after a no-op read", async () => {
  await ia.getInstanceAuthSettings();
  const s = await ia.getInstanceAuthSettings();
  assert.equal(s.multiUserEnabled, false);
});
