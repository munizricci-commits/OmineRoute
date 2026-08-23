/**
 * 07-invitations / Task 03 — authorized creation of invitations (platform admin / org owner).
 *
 * Integration proof: POST /api/organizations/:id/invitations requires an
 * authorized actor (platform admin or org owner), validates email, enforces
 * policy, and creates a pending invitation. Unauthorized -> 401/403. Uses a real
 * JWT cookie (signed with JWT_SECRET) so the auth path matches production.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-invcreate-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "test-jwt-secret-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createOrganization } = await import("../../src/lib/db/organizations.ts");
const { getInvitationsByOrganization } = await import("../../src/lib/db/invitations.ts");
const routeMod =
  await import("../../src/app/api/organizations/[organizationId]/invitations/route.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function jwtFor(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

async function req(orgId: string, body: unknown, userId?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) {
    const token = await jwtFor(userId);
    headers["cookie"] = `auth_token=${token}`;
  }
  return new Request(`http://localhost/api/organizations/${orgId}/invitations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function call(orgId: string, body: unknown, userId?: string) {
  const request = await req(orgId, body, userId);
  return routeMod.POST(request, { params: Promise.resolve({ organizationId: orgId }) });
}

test("unauthenticated request is rejected (401)", async () => {
  const res = await call("org-1", { email: "a@x.io" });
  assert.equal(res.status, 401);
});

test("platform admin can create an invitation", async () => {
  const admin = createUserSync({ role: "platform_admin", email: "admin@x.io" });
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const res = await call(org.id, { email: "invitee@x.io", role: "user" }, admin.id);
  assert.equal(res.status, 201);
  const list = await getInvitationsByOrganization(org.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].email, "invitee@x.io");
});

test("org owner can create an invitation for their org", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const res = await call(org.id, { email: "invitee@x.io" }, owner.id);
  assert.equal(res.status, 201);
});

test("non-owner non-admin is forbidden (403)", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const stranger = createUserSync({ role: "user", email: "stranger@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const res = await call(org.id, { email: "invitee@x.io" }, stranger.id);
  assert.equal(res.status, 403);
});

test("invalid email is rejected (400)", async () => {
  const admin = createUserSync({ role: "platform_admin", email: "admin@x.io" });
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const res = await call(org.id, { email: "not-an-email" }, admin.id);
  assert.equal(res.status, 400);
});
