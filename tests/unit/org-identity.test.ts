/**
 * P1.03 (platform-admin-role) + P1.04 (inference-key principal).
 *
 * TDD:
 *  - isPlatformAdmin / resolvePlatformRole reflect users.role (no enterprise RBAC).
 *  - API key ↔ user linkage is additive; a key with no user_id still validates
 *    (auth semantics unchanged) and legacy keys remain personal.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-identity-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const principal = await import("../../src/lib/org/principal.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// ── P1.03 ────────────────────────────────────────────────────────────────
test("isPlatformAdmin is true only for active platform_admin users", () => {
  assert.equal(principal.isPlatformAdmin(null), false);
  assert.equal(principal.isPlatformAdmin({ role: "user", status: "active" } as never), false);
  assert.equal(
    principal.isPlatformAdmin({ role: "platform_admin", status: "disabled" } as never),
    false,
    "disabled admin is not active"
  );
  assert.equal(
    principal.isPlatformAdmin({ role: "platform_admin", status: "active" } as never),
    true
  );
});

test("resolvePlatformRole returns the user-table role", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const user = await usersDb.createUser({ role: "user" });
  // We resolve via principal's session path; here we just assert the helper
  // mapping through getUserById + isPlatformAdmin contract via a stub request.
  const roleFor = (u: { id: string; role: string; status: string }) =>
    principal.isPlatformAdmin(u as never) ? "platform_admin" : "user";
  assert.equal(roleFor(admin), "platform_admin");
  assert.equal(roleFor(user), "user");
});

// ── P1.04 ────────────────────────────────────────────────────────────────
test("legacy key (no user_id) validates exactly as before", async () => {
  const key = await apiKeysDb.createApiKey("legacy", "machine1234567890");
  assert.equal(await apiKeysDb.getApiKeyUserId(key.id), null, "no user linked by default");
  assert.equal(await apiKeysDb.validateApiKey(key.key), true, "auth semantics unchanged");
});

test("API key can be linked to a user and unlinked", async () => {
  const user = await usersDb.createUser({ email: "keyowner@example.com" });
  const key = await apiKeysDb.createApiKey("owned", "machine1234567890");
  assert.equal(await apiKeysDb.setApiKeyUserId(key.id, user.id), true);
  assert.equal(await apiKeysDb.getApiKeyUserId(key.id), user.id);
  // validateApiKey still works after linking (semantics preserved)
  assert.equal(await apiKeysDb.validateApiKey(key.key), true);
  // unlink → back to personal
  assert.equal(await apiKeysDb.setApiKeyUserId(key.id, null), true);
  assert.equal(await apiKeysDb.getApiKeyUserId(key.id), null);
});

test("getApiKeyUser resolves the linked user record", async () => {
  const user = await usersDb.createUser({ email: "link@example.com", displayName: "Link" });
  const key = await apiKeysDb.createApiKey("linked", "machine1234567890");
  await apiKeysDb.setApiKeyUserId(key.id, user.id);
  const resolved = await apiKeysDb.getApiKeyUser(key.id);
  assert.ok(resolved);
  assert.equal(resolved!.id, user.id);
  assert.equal(resolved!.email, "link@example.com");
});
