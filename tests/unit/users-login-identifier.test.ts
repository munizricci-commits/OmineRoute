/**
 * 01-admin-identity / Task 01 — durable login identifier on the user identity.
 *
 * RED→GREEN: adds a nullable `login_identifier` column to `users` and exposes it
 * through the db module WITHOUT changing authentication behavior. Uniqueness and
 * normalization are implemented later (Task 03); this task only stores and reads
 * the identifier so downstream tasks (login-by-identifier, backfill) have a field.
 *
 * TDD: every assertion must fail before the migration + db change, then pass.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-users-loginid-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-users-loginid";

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

test("createUser persists a login_identifier and getUserById returns it", async () => {
  const user = await usersDb.createUser({
    email: "admin@example.com",
    displayName: "Admin",
    loginIdentifier: "admin",
  });
  assert.equal(user.loginIdentifier, "admin");
  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, "admin");
});

test("login_identifier is optional and stored as null when omitted (backward compatible)", async () => {
  const user = await usersDb.createUser({ email: "plain@example.com" });
  assert.equal(user.loginIdentifier, null);
  const refetched = await usersDb.getUserById(user.id);
  assert.equal(refetched?.loginIdentifier, null);
});

test("getUserByLoginIdentifier resolves the user by exact identifier", async () => {
  await usersDb.createUser({ loginIdentifier: "teamlead", email: "tl@example.com" });
  const found = await usersDb.getUserByLoginIdentifier("teamlead");
  assert.ok(found);
  assert.equal(found?.loginIdentifier, "teamlead");
});

test("getUserByLoginIdentifier returns null for unknown identifier", async () => {
  const found = await usersDb.getUserByLoginIdentifier("does-not-exist");
  assert.equal(found, null);
});

test("updateUser can set and clear a login_identifier", async () => {
  const user = await usersDb.createUser({ email: "u@example.com" });
  const updated = await usersDb.updateUser(user.id, { loginIdentifier: "newid" });
  assert.equal(updated?.loginIdentifier, "newid");
  const cleared = await usersDb.updateUser(user.id, { loginIdentifier: null });
  assert.equal(cleared?.loginIdentifier, null);
});

test("backward compatible: existing personal flow needs no login_identifier", async () => {
  // The user table still works for org/membership without a login identifier.
  const user = await usersDb.createUser({ role: "platform_admin" });
  assert.equal(user.loginIdentifier, null);
  assert.equal(user.role, "platform_admin");
});
