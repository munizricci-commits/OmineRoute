/**
 * P1.02 — user-session-principal: dashboard auth resolves a typed user principal
 * while preserving the management-password bootstrap.
 *
 * TDD: happy path (session with sub → principal), legacy session (no sub → null
 * principal but still authenticated), invalid/expired token → null, disabled
 * user → null.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-principal-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-for-principal-tests";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const principal = await import("../../src/lib/org/principal.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

function makeCookieRequest(token: string | null) {
  return {
    cookies: {
      get(name: string) {
        return name === "auth_token" && token ? { value: token } : undefined;
      },
    },
    headers: new Headers(),
  } as unknown as Request;
}

async function signToken(claims: Record<string, unknown>, exp = "1h") {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(exp)
    .sign(secret);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("resolves a typed principal when the session JWT carries a sub claim", async () => {
  const user = await usersDb.createUser({ email: "alice@example.com", displayName: "Alice" });
  const token = await signToken({ authenticated: true, sub: user.id });
  const p = await principal.resolveDashboardUserPrincipal(makeCookieRequest(token));
  assert.ok(p);
  assert.equal(p!.userId, user.id);
  assert.equal(p!.user.email, "alice@example.com");
  assert.equal(p!.isOrganizationScoped, false);
});

test("legacy session without sub claim resolves to the bootstrap platform admin", async () => {
  // Management-password bootstrap sessions carry no `sub` claim and, on a fresh
  // database, no user row exists yet. The feature requires such a session to
  // resolve to a user principal (otherwise the Organizations API is unusable
  // for the bootstrap admin). resolveDashboardUserPrincipal lazily creates the
  // bootstrap platform_admin and resolves to it.
  const token = await signToken({ authenticated: true });
  const p = await principal.resolveDashboardUserPrincipal(makeCookieRequest(token));
  assert.ok(p, "legacy session must resolve to the bootstrap admin");
  assert.equal(principal.isPlatformAdmin(p!.user), true, "bootstrap user is platform_admin");
});

test("null principal for an unknown sub (user deleted after login)", async () => {
  const token = await signToken({ authenticated: true, sub: "ghost-user-id" });
  const p = await principal.resolveDashboardUserPrincipal(makeCookieRequest(token));
  assert.equal(p, null);
});

test("disabled user resolves to null principal", async () => {
  const user = await usersDb.createUser({ email: "bob@example.com" });
  await usersDb.updateUser(user.id, { status: "disabled" });
  const token = await signToken({ authenticated: true, sub: user.id });
  const p = await principal.resolveDashboardUserPrincipal(makeCookieRequest(token));
  assert.equal(p, null);
});

test("invalid token yields null principal", async () => {
  const p = await principal.resolveDashboardUserPrincipal(makeCookieRequest("not-a-real-jwt"));
  assert.equal(p, null);
});
