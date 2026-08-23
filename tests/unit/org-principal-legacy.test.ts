/**
 * P-fix (TDD): resolveDashboardUserPrincipal must resolve a legacy dashboard
 * session (JWT authenticated but WITHOUT a `sub` claim — exactly what the
 * real management-password login emits) to the first active user (the bootstrap
 * platform_admin), so the Organizations API is usable from the dashboard.
 *
 * Regression anchor: a JWT WITH `sub` still resolves by id (unchanged).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-princ-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret-principal";

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

test("legacy session JWT without `sub` resolves to first active user (bootstrap admin)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  // Real management-password login emits exactly this payload (no `sub`).
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const legacyToken = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .sign(secret);

  const p = await principal.resolveDashboardUserPrincipal(makeRequest(legacyToken));
  assert.ok(p, "legacy session must resolve to a principal");
  assert.equal(p!.userId, admin.id, "resolves to the first active user");
  assert.equal(principal.isPlatformAdmin(p!.user), true);
});

test("JWT with `sub` still resolves by id (unchanged behavior)", async () => {
  const u = await usersDb.createUser({ role: "user" });
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const subToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setExpirationTime("2h")
    .sign(secret);

  const p = await principal.resolveDashboardUserPrincipal(makeRequest(subToken));
  assert.ok(p);
  assert.equal(p!.userId, u.id);
});

test("unauthenticated request resolves to null", async () => {
  const p = await principal.resolveDashboardUserPrincipal(makeRequest(null));
  assert.equal(p, null);
});
