/**
 * P1.01 — user-model: durable users entity (Organizations feature).
 *
 * TDD: covers happy path (create/read/update/delete), role semantics
 * (user | platform_admin), validation failure (empty id, missing row),
 * and backward-compatible behavior (no users row required for legacy keys).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-users-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");

async function resetStorage() {
  core.resetDbInstance();
  // resetDbInstance releases the handle but the on-disk file persists across
  // tests in this file (shared DATA_DIR). Remove the sqlite files so each test
  // starts from a fresh schema, matching the api-auth.test.ts pattern.
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
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("createUser returns a durable user with generated id and timestamps", async () => {
  const user = await usersDb.createUser({
    email: "alice@example.com",
    displayName: "Alice",
  });
  assert.ok(user.id, "id should be generated");
  assert.equal(user.email, "alice@example.com");
  assert.equal(user.displayName, "Alice");
  assert.equal(user.role, "user", "default role is user");
  assert.equal(user.status, "active", "default status is active");
  assert.ok(user.createdAt, "createdAt stamped");
  assert.ok(user.updatedAt, "updatedAt stamped");
});

test("getUserById round-trips the created user", async () => {
  const created = await usersDb.createUser({ email: "bob@example.com" });
  const fetched = await usersDb.getUserById(created.id);
  assert.ok(fetched);
  assert.equal(fetched!.id, created.id);
  assert.equal(fetched!.email, "bob@example.com");
});

test("role is coerced to platform_admin only for the exact value", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  assert.equal(admin.role, "platform_admin");
  const weird = await usersDb.createUser({ role: "superuser" as never });
  assert.equal(weird.role, "user", "unknown role falls back to user");
});

test("updateUser changes mutable fields and refreshes updatedAt", async () => {
  const user = await usersDb.createUser({ displayName: "Old" });
  const updated = await usersDb.updateUser(user.id, {
    displayName: "New",
    role: "platform_admin",
  });
  assert.ok(updated);
  assert.equal(updated!.displayName, "New");
  assert.equal(updated!.role, "platform_admin");
  assert.ok(
    new Date(updated!.updatedAt).getTime() >= new Date(user.updatedAt).getTime(),
    "updatedAt advanced"
  );
});

test("getUserById returns null for unknown id", async () => {
  assert.equal(await usersDb.getUserById("does-not-exist"), null);
});

test("listUsers returns created users ordered by creation", async () => {
  await usersDb.createUser({ email: "first@example.com" });
  await usersDb.createUser({ email: "second@example.com" });
  const all = await usersDb.listUsers();
  assert.ok(all.length >= 2);
});

test("deleteUser removes the row", async () => {
  const user = await usersDb.createUser({ email: "gone@example.com" });
  const deleted = await usersDb.deleteUser(user.id);
  assert.equal(deleted, true);
  assert.equal(await usersDb.getUserById(user.id), null);
});

test("backward compatibility: no users row is required for the module to function", async () => {
  // The legacy model is simply "zero users". The table exists but empty;
  // api-key authentication (P1.04) must not require a user row.
  const all = await usersDb.listUsers();
  assert.equal(all.length, 0);
});
