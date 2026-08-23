/**
 * 01-admin-identity / Task 02 — backfill existing users with a deterministic
 * login identifier (preserving the existing password, which lives in the
 * management-password env, not the users table).
 *
 * TDD: fails before backfillUserLoginIdentifiers exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-users-backfill-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-users-backfill";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");

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

test("backfill assigns the email local-part as login_identifier", async () => {
  const user = await usersDb.createUser({ email: "alice@example.com", role: "user" });
  assert.equal(user.loginIdentifier, null);
  const updated = await usersDb.backfillUserLoginIdentifiers();
  assert.ok(updated >= 1);
  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, "alice");
});

test("backfill assigns 'admin' to a platform_admin without an email", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  assert.equal(admin.loginIdentifier, null);
  await usersDb.backfillUserLoginIdentifiers();
  const refetched = await usersDb.getUserById(admin.id);
  assert.equal(refetched?.loginIdentifier, "admin");
});

test("backfill is idempotent: a second run changes nothing", async () => {
  const user = await usersDb.createUser({ email: "bob@example.com" });
  const first = await usersDb.backfillUserLoginIdentifiers();
  const second = await usersDb.backfillUserLoginIdentifiers();
  assert.ok(first >= 1);
  assert.equal(second, 0, "no further changes on repeat");
  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, "bob");
});

test("backfill does not overwrite an existing login_identifier", async () => {
  const user = await usersDb.createUser({ email: "carol@example.com", loginIdentifier: "carolx" });
  const updated = await usersDb.backfillUserLoginIdentifiers();
  assert.equal(updated, 0);
  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, "carolx");
});
