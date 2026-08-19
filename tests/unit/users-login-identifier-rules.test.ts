/**
 * 01-admin-identity / Task 03 — normalization, uniqueness and validation for
 * login identifiers.
 *
 * TDD: fails before normalize/validate/uniqueness enforcement exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-users-norm-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-users-norm";

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

test("normalizeLoginIdentifier trims and lowercases", () => {
  assert.equal(usersDb.normalizeLoginIdentifier("  Admin@Example.com  "), "admin@example.com");
  assert.equal(usersDb.normalizeLoginIdentifier("BOB"), "bob");
  assert.equal(usersDb.normalizeLoginIdentifier(""), null);
  assert.equal(usersDb.normalizeLoginIdentifier(null), null);
});

test("validateLoginIdentifier accepts a simple name and rejects empty/whitespace", () => {
  assert.equal(usersDb.validateLoginIdentifier("admin").ok, true);
  assert.equal(usersDb.validateLoginIdentifier("alice@example.com").ok, true);
  assert.equal(usersDb.validateLoginIdentifier("a_b.c").ok, true);
  assert.equal(usersDb.validateLoginIdentifier("").ok, false);
  assert.equal(usersDb.validateLoginIdentifier("has space").ok, false);
  assert.equal(usersDb.validateLoginIdentifier("bad!char").ok, false);
});

test("createUser rejects a duplicate login_identifier (uniqueness, fail-closed)", async () => {
  await usersDb.createUser({ loginIdentifier: "alice" });
  await assert.rejects(() => usersDb.createUser({ loginIdentifier: "alice" }), /login identifier/i);
});

test("createUser enforces case-insensitive uniqueness via normalization", async () => {
  await usersDb.createUser({ loginIdentifier: "Admin" });
  await assert.rejects(() => usersDb.createUser({ loginIdentifier: "admin" }), /login identifier/i);
});

test("createUser rejects an invalid login_identifier (validation)", async () => {
  await assert.rejects(
    () => usersDb.createUser({ loginIdentifier: "has space" }),
    /login identifier/i
  );
});

test("updateUser rejects a login_identifier that collides with another user", async () => {
  await usersDb.createUser({ loginIdentifier: "alice" });
  const bob = await usersDb.createUser({ loginIdentifier: "bob" });
  await assert.rejects(
    () => usersDb.updateUser(bob.id, { loginIdentifier: "alice" }),
    /login identifier/i
  );
});

test("updateUser allows keeping its own existing login_identifier", async () => {
  const u = await usersDb.createUser({ loginIdentifier: "carol" });
  const updated = await usersDb.updateUser(u.id, { loginIdentifier: "Carol" });
  assert.equal(updated?.loginIdentifier, "carol");
});
