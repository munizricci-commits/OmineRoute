/**
 * 03-platform-user-admin / Task 06 — platform admin blocks/unblocks non-protected users.
 *
 * Integration proof: POST /api/auth/users/:id/status sets status for a non-protected
 * user (200), rejects ordinary users (403), and refuses to change a protected
 * (platform-admin) account (409/ProtectedUserError). TDD: fails before route/service.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-block-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-block";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const route = await import("../../src/app/api/auth/users/[id]/status/route.ts");

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

function req(token: string, body?: unknown): Request {
  return new Request("http://localhost/api/auth/users/x/status", {
    method: "POST",
    headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("platform admin can block a non-protected user", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const user = await usersDb.createUser({ role: "user" });
  const token = await makeToken(admin.id);
  const res = await route.POST(req(token, { status: "blocked" }), {
    params: Promise.resolve({ id: user.id }),
  });
  assert.equal(res.status, 200);
  const updated = await usersDb.getUserById(user.id);
  assert.equal(updated?.status, "blocked");
});

test("platform admin can unblock a user", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const user = await usersDb.createUser({ role: "user", status: "blocked" });
  const token = await makeToken(admin.id);
  const res = await route.POST(req(token, { status: "active" }), {
    params: Promise.resolve({ id: user.id }),
  });
  assert.equal(res.status, 200);
  const updated = await usersDb.getUserById(user.id);
  assert.equal(updated?.status, "active");
});

test("ordinary user is rejected (403)", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const token = await makeToken(user.id);
  const res = await route.POST(req(token, { status: "blocked" }), {
    params: Promise.resolve({ id: user.id }),
  });
  assert.equal(res.status, 403);
});

test("platform admin cannot block another platform admin (protected)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const otherAdmin = await usersDb.createUser({ role: "platform_admin" });
  const token = await makeToken(admin.id);
  const res = await route.POST(req(token, { status: "blocked" }), {
    params: Promise.resolve({ id: otherAdmin.id }),
  });
  assert.equal(res.status, 409);
  const still = await usersDb.getUserById(otherAdmin.id);
  assert.equal(still?.status, "active");
});
