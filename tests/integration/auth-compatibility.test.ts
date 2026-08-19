/**
 * 01-admin-identity / Task 06 — prove upgraded installations and existing
 * management-password authentication remain compatible.
 *
 * Regression coverage: the pre-existing management-password login (no login
 * field) must keep working, an upgraded install (users that gained a
 * login_identifier via backfill) must authenticate by that identifier, and a
 * fresh/empty database must not break.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-auth-compat-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-auth-compat";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const misc = await import("../../src/shared/validation/schemas/misc.ts");
const { buildLoginPayload } = await import("../../src/lib/auth/loginPayload.ts");

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

test("legacy management-password payload (no login) still validates", () => {
  // Pre-existing installations send only a password; the schema must accept it.
  const legacy = misc.loginSchema.safeParse({ password: "correct-horse" });
  assert.equal(legacy.success, true);
  const payload = buildLoginPayload("correct-horse");
  assert.deepEqual(payload, { password: "correct-horse" });
});

test("upgraded install: user gains a login_identifier via backfill and can be resolved", async () => {
  // Simulate an upgraded installation: a user existed before login identifiers.
  const user = await usersDb.createUser({ email: "admin@example.com", role: "platform_admin" });
  assert.equal(user.loginIdentifier, null);

  const changed = await usersDb.backfillUserLoginIdentifiers();
  assert.equal(changed, 1);

  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, "admin");

  // The login flow can now resolve this user by the backfilled identifier.
  const resolved = await usersDb.resolveUserByIdentifierOrEmail("admin");
  assert.ok(resolved);
  assert.equal(resolved?.id, user.id);
});

test("fresh/empty database: backfill is a no-op and does not throw", async () => {
  const changed = await usersDb.backfillUserLoginIdentifiers();
  assert.equal(changed, 0);
});

test("unknown login identifier does not impersonate another user", async () => {
  await usersDb.createUser({ loginIdentifier: "alice", email: "alice@example.com" });
  const resolved = await usersDb.resolveUserByIdentifierOrEmail("bob");
  assert.equal(resolved, null);
});

test("login by email local-part and by login_identifier both resolve the same user", async () => {
  const user = await usersDb.createUser({ loginIdentifier: "carol", email: "carol@example.com" });
  const byId = await usersDb.resolveUserByIdentifierOrEmail("carol");
  const byEmail = await usersDb.resolveUserByIdentifierOrEmail("carol@example.com");
  assert.equal(byId?.id, user.id);
  assert.equal(byEmail?.id, user.id);
});
