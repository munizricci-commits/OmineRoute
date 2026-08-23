/**
 * 03-platform-user-admin / Task 01 — platform-admin-only users listing endpoint.
 *
 * Integration proof: GET /api/auth/users returns safe summary fields for a
 * platform admin, rejects ordinary users (403, no data), and never exposes
 * secrets. TDD: fails before the route + helper exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-users-list-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-users-list";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const route = await import("../../src/app/api/auth/users/route.ts");

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

async function makeToken(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

function req(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["cookie"] = `auth_token=${token}`;
  return new Request("http://localhost/api/auth/users", { headers });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("platform admin lists users with safe fields (200, no secrets)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin", email: "admin@example.com" });
  await usersDb.createUser({ role: "user", email: "bob@example.com" });
  const token = await makeToken(admin.id);
  const res = await route.GET(req(token));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.users));
  assert.ok(body.users.length >= 2);
  for (const u of body.users) {
    assert.ok("id" in u);
    assert.ok("role" in u);
    assert.ok("status" in u);
    assert.equal(u.password, undefined);
    assert.equal(u.passwordHash, undefined);
  }
});

test("ordinary user is rejected (403), no user data disclosed", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const token = await makeToken(user.id);
  const res = await route.GET(req(token));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.users, undefined);
});

test("unauthenticated request is rejected (401)", async () => {
  const res = await route.GET(req());
  assert.equal(res.status, 401);
});
