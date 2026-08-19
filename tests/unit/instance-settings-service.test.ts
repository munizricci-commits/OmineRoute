/**
 * 02-multi-user-mode / Task 02 — platform-admin-only instance auth settings access.
 *
 * Thin, pure/testable service enforcing the platform-admin gate. The route layer
 * (src/app/api/auth/instance-settings) delegates here after resolving the principal.
 *
 * TDD: fails before the service exists, then passes. Authorization is enforced
 * server-side (fail-closed) — a non-admin user is rejected before any read/write.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-instance-svc-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-instance-svc";

const core = await import("../../src/lib/db/core.ts");
const svc = await import("../../src/lib/auth/instanceSettingsService.ts");

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

const admin = { id: "u-admin", role: "platform_admin", status: "active" } as const;
const ordinary = { id: "u-user", role: "user", status: "active" } as const;

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("platform admin can read instance auth settings", async () => {
  const s = await svc.getAuthSettingsForAdmin(admin);
  assert.equal(s.multiUserEnabled, false);
  assert.equal(s.registrationPolicy, "disabled");
});

test("non-admin is rejected from reading settings (fail-closed)", async () => {
  await assert.rejects(() => svc.getAuthSettingsForAdmin(ordinary), /platform admin/i);
});

test("platform admin can update instance auth settings", async () => {
  const updated = await svc.updateAuthSettingsForAdmin(admin, {
    multiUserEnabled: true,
    registrationPolicy: "invite-only",
  });
  assert.equal(updated.multiUserEnabled, true);
  assert.equal(updated.registrationPolicy, "invite-only");
});

test("non-admin is rejected from updating settings (fail-closed)", async () => {
  await assert.rejects(
    () =>
      svc.updateAuthSettingsForAdmin(ordinary, {
        multiUserEnabled: true,
        registrationPolicy: "invite-only",
      }),
    /platform admin/i
  );
  // unchanged
  const s = await svc.getAuthSettingsForAdmin(admin);
  assert.equal(s.multiUserEnabled, false);
});
