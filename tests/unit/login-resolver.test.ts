/**
 * 01-admin-identity / Task 04 — login accepts a login identifier plus password.
 *
 * TDD: fails before resolveUserByIdentifierOrEmail exists / loginSchema accepts
 * `login`, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-login-resolver-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-login-resolver";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const misc = await import("../../src/shared/validation/schemas/misc.ts");

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

test("resolveUserByIdentifierOrEmail finds by normalized login_identifier", async () => {
  await usersDb.createUser({ loginIdentifier: "alice", email: "alice@example.com" });
  const byId = await usersDb.resolveUserByIdentifierOrEmail("Alice");
  assert.ok(byId);
  assert.equal(byId?.loginIdentifier, "alice");
});

test("resolveUserByIdentifierOrEmail finds by email local/domain", async () => {
  await usersDb.createUser({ loginIdentifier: "bob", email: "bob@example.com" });
  const byEmail = await usersDb.resolveUserByIdentifierOrEmail("bob@example.com");
  assert.ok(byEmail);
  assert.equal(byEmail?.email, "bob@example.com");
});

test("resolveUserByIdentifierOrEmail returns null for unknown login", async () => {
  const found = await usersDb.resolveUserByIdentifierOrEmail("ghost");
  assert.equal(found, null);
});

test("resolveUserByIdentifierOrEmail returns null for empty input", async () => {
  assert.equal(await usersDb.resolveUserByIdentifierOrEmail(""), null);
  assert.equal(await usersDb.resolveUserByIdentifierOrEmail(null), null);
});

test("loginSchema accepts an optional login field", () => {
  const withLogin = misc.loginSchema.safeParse({ password: "x", login: "admin" });
  assert.equal(withLogin.success, true);
  const withoutLogin = misc.loginSchema.safeParse({ password: "x" });
  assert.equal(withoutLogin.success, true);
  const emptyLogin = misc.loginSchema.safeParse({ password: "x", login: "" });
  assert.equal(emptyLogin.success, true);
});
