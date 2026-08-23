/**
 * 03-platform-user-admin / Task 03 — safe user details incl. org memberships + role.
 *
 * Integration proof: GET /api/auth/users/:id returns safe detail (platform role +
 * organization memberships) for a platform admin, 403 for ordinary users, 404 for
 * unknown id. TDD: fails before route/service exist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-user-detail-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-user-detail";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const route = await import("../../src/app/api/auth/users/[id]/route.ts");

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

function req(token: string): Request {
  return new Request("http://localhost/api/auth/users/x", {
    headers: { cookie: `auth_token=${token}` },
  });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("platform admin sees detail with org memberships and platform role", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: admin.id,
  });
  const user = await usersDb.createUser({ role: "user", email: "bob@example.com" });
  await membersDb.addMember({
    organizationId: org.id,
    userId: user.id,
    role: "member",
    invitedBy: admin.id,
    actorUserId: admin.id,
  });
  const token = await makeToken(admin.id);
  const res = await route.GET(req(token), { params: Promise.resolve({ id: user.id }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, user.id);
  assert.equal(body.platformRole, "user");
  assert.equal(body.password, undefined);
  assert.ok(Array.isArray(body.memberships));
  assert.equal(body.memberships.length, 1);
  assert.equal(body.memberships[0].organizationId, org.id);
  assert.ok(typeof body.memberships[0].role === "string" && body.memberships[0].role.length > 0);
});

test("ordinary user is rejected (403)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const user = await usersDb.createUser({ role: "user" });
  const token = await makeToken(user.id);
  const res = await route.GET(req(token), { params: Promise.resolve({ id: admin.id }) });
  assert.equal(res.status, 403);
});

test("unknown user id returns 404 (no data)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const token = await makeToken(admin.id);
  const res = await route.GET(req(token), { params: Promise.resolve({ id: "does-not-exist" }) });
  assert.equal(res.status, 404);
});
