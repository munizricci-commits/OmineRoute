/**
 * P1.01 bootstrap gap fix (TDD): on a FRESH database (no users row) a legacy
 * dashboard session (JWT without `sub`, exactly what the management-password
 * login emits) must lazily create the bootstrap platform_admin and resolve to
 * it — so the Organizations API works out-of-the-box without manual user seeding.
 *
 * Regression anchor: once a normal user exists, the legacy session resolves to
 * the first active user (never creates a second admin).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-boot-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret-bootstrap";
process.env.JWT_SECRET = "test-jwt-secret-bootstrap";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const principal = await import("../../src/lib/org/principal.ts");

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}
test.beforeEach(() => resetStorage());
test.after(() => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

function makeRequest(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("cookie", `auth_token=${token}`);
  return new Request("http://localhost/api/x", { headers });
}

test("fresh DB + legacy session lazily creates bootstrap admin and resolves to it", async () => {
  // Sanity: DB starts with NO users.
  assert.equal((await usersDb.listUsers(10, 0)).length, 0, "DB should start empty");

  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const legacyToken = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .sign(secret);

  const p = await principal.resolveDashboardUserPrincipal(makeRequest(legacyToken));
  assert.ok(p, "legacy session must resolve on fresh DB");
  assert.equal(principal.isPlatformAdmin(p!.user), true, "bootstrap user is platform_admin");

  // Exactly ONE user was created.
  const all = await usersDb.listUsers(10, 0);
  assert.equal(all.length, 1, "exactly one bootstrap user created");
  assert.equal(all[0].id, p!.userId);
});

test("once a normal user exists, legacy session does NOT create a second admin", async () => {
  const existing = await usersDb.createUser({ role: "user", status: "active" });
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const legacyToken = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .sign(secret);

  const p = await principal.resolveDashboardUserPrincipal(makeRequest(legacyToken));
  assert.ok(p);
  assert.equal(p!.userId, existing.id, "resolves to the existing active user, not a new admin");
  assert.equal((await usersDb.listUsers(10, 0)).length, 1, "no extra admin created");
});
