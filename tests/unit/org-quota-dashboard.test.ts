/**
 * P9.04 — quota-dashboard: organization quota is exposed via the P8 organizations
 * API (GET /[id]/quota) with fail-closed authorization. Managers may also set it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-quota-dash-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret-for-org-quota-dash";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const orgQuotas = await import("../../src/lib/db/orgQuotas.ts");
const api = await import("../../src/lib/org/orgApiService.ts");

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(() => {
  resetStorage();
});

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

async function authedAs(userId: string, method: string, body?: unknown): Promise<Request> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .sign(secret);
  const headers = new Headers({ Cookie: `auth_token=${token}` });
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("Content-Type", "application/json");
  }
  return new Request("http://localhost/api/organizations/x/quota", init);
}

function paramsOf(id: string) {
  return { params: Promise.resolve({ id }) } as { params: Promise<{ id: string }> };
}

async function makeOrg() {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Team 1",
    slug: "team1",
    ownerUserId: owner.id,
  });
  return { owner, org };
}

test("manager can read org quota (null when unconfigured)", async () => {
  const { owner, org } = await makeOrg();
  const req = await authedAs(owner.id, "GET");
  const res = await api.getOrganizationQuotaHandler(req, paramsOf(org.id));
  assert.equal(res.status, 200);
  const data = (await res.json()).data;
  assert.equal(data, null, "unconfigured org => null quota");
});

test("manager can set org quota (POST /[id]/quota)", async () => {
  const { owner, org } = await makeOrg();
  const setReq = await authedAs(owner.id, "POST", {
    limit: 100,
    window: "daily",
    scope: "requests",
  });
  const setRes = await api.setOrganizationQuotaHandler(setReq, paramsOf(org.id));
  assert.equal(setRes.status, 200);
  assert.equal((await setRes.json()).data.limit, 100);

  const getReq = await authedAs(owner.id, "GET");
  const getRes = await api.getOrganizationQuotaHandler(getReq, paramsOf(org.id));
  assert.equal((await getRes.json()).data.limit, 100);
});

test("non-manager member cannot set org quota (403)", async () => {
  const { owner, org } = await makeOrg();
  // Add a plain member (role user) directly. Note: the low-level
  // acceptInvitation() does NOT create the membership row (callers wire
  // membership creation at the API layer, per P7.05), so we add the member
  // explicitly here to model a real non-manager membership.
  const member = await usersDb.createUser({ role: "user" });
  const membersDb = await import("../../src/lib/db/members.ts");
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: owner.id,
  });
  const req = await authedAs(member.id, "POST", {
    limit: 100,
    window: "daily",
    scope: "requests",
  });
  const res = await api.setOrganizationQuotaHandler(req, paramsOf(org.id));
  assert.equal(res.status, 403, "plain member must be rejected");
});

test("non-member cannot read org quota (fail-closed 404)", async () => {
  const { owner, org } = await makeOrg();
  const outsider = await usersDb.createUser({ role: "user" });
  const req = await authedAs(outsider.id, "GET");
  const res = await api.getOrganizationQuotaHandler(req, paramsOf(org.id));
  assert.equal(res.status, 404, "non-member must not resolve the org quota");
});

test("invalid quota payload is rejected (400)", async () => {
  const { owner, org } = await makeOrg();
  const req = await authedAs(owner.id, "POST", { limit: -5, window: "daily", scope: "requests" });
  const res = await api.setOrganizationQuotaHandler(req, paramsOf(org.id));
  assert.equal(res.status, 400);
});
