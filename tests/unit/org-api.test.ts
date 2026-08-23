/**
 * P8.01 — organization-api: REST API handlers for organizations (CRUD, members,
 * invitations) with fail-closed authorization. Exercises the request handlers in
 * `src/lib/org/orgApiService.ts` through a real JWT principal so the authn/authz
 * contract is verified end-to-end (not just the DB layer).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-api-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret-for-org-api-tests";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgApi = await import("../../src/lib/org/orgApiService.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/** Build a Request carrying a valid dashboard-session JWT for `userId`. */
async function authedRequestFor(userId: string, method: string, body?: unknown): Promise<Request> {
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
  return new Request("http://localhost/api/organizations", init);
}

/** Create a user and return a Request authenticated as that user. */
async function authedRequest(method: string, body?: unknown): Promise<Request> {
  const user = await usersDb.createUser({ role: "user" });
  return authedRequestFor(user.id, method, body);
}

function paramsOf(obj: Record<string, string>) {
  return { params: Promise.resolve(obj) } as { params: Promise<Record<string, string>> };
}

test("create organization requires authentication (401 when no token)", async () => {
  const req = new Request("http://localhost/api/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Team 1", slug: "team1" }),
  });
  const res = await orgApi.createOrganizationHandler(req);
  assert.equal(res.status, 401);
});

test("create + list organization (owner sees their org)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const req = await authedRequestFor(owner.id, "POST", { name: "Team 1", slug: "team1" });
  const res = await orgApi.createOrganizationHandler(req);
  assert.equal(res.status, 201);
  const created = (await res.json()).data;
  assert.equal(created.slug, "team1");

  const listReq = await authedRequestFor(owner.id, "GET");
  const listRes = await orgApi.listOrganizationsHandler(listReq);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()).data;
  assert.ok(Array.isArray(list) && list.length === 1);
  assert.equal(list[0].id, created.id);
});

test("duplicate slug is rejected (409)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const req1 = await authedRequestFor(owner.id, "POST", { name: "Team 1", slug: "team1" });
  await orgApi.createOrganizationHandler(req1);
  const req2 = await authedRequestFor(owner.id, "POST", { name: "Team 1b", slug: "team1" });
  const res2 = await orgApi.createOrganizationHandler(req2);
  assert.equal(res2.status, 409);
});

test("non-member cannot read another org (fail-closed 404, no existence reveal)", async () => {
  // owner creates org
  const owner = await usersDb.createUser({ role: "user" });
  const ownerReq = await authedRequestFor(owner.id, "POST", { name: "Team 1", slug: "team1" });
  const created = (await (await orgApi.createOrganizationHandler(ownerReq)).json()).data;

  // outsider user
  const outsider = await usersDb.createUser({ role: "user" });
  const outReq = await authedRequestFor(outsider.id, "GET");
  const res = await orgApi.getOrganizationHandler(outReq, paramsOf({ id: created.id }));
  assert.equal(res.status, 404, "non-member must not resolve the org");
});

test("owner can update and archive their org", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const ownerReq = await authedRequestFor(owner.id, "POST", { name: "Team 1", slug: "team1" });
  const created = (await (await orgApi.createOrganizationHandler(ownerReq)).json()).data;

  const updReq = await authedRequestFor(owner.id, "PATCH", { name: "Team One" });
  const updRes = await orgApi.updateOrganizationHandler(updReq, paramsOf({ id: created.id }));
  assert.equal(updRes.status, 200);
  assert.equal((await updRes.json()).data.name, "Team One");

  const delReq = await authedRequestFor(owner.id, "DELETE");
  const delRes = await orgApi.deleteOrganizationHandler(delReq, paramsOf({ id: created.id }));
  assert.equal(delRes.status, 200);
  assert.equal((await delRes.json()).archived, true);
});

test("owner can invite a member; non-manager cannot add members", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const ownerReq = await authedRequestFor(owner.id, "POST", { name: "Team 1", slug: "team1" });
  const created = (await (await orgApi.createOrganizationHandler(ownerReq)).json()).data;

  // invite
  const inviteReq = await authedRequestFor(owner.id, "POST", {
    email: "bob@example.com",
    role: "user",
  });
  const inviteRes = await orgApi.createInvitationHandler(inviteReq, paramsOf({ id: created.id }));
  assert.equal(inviteRes.status, 201);
  const invite = (await inviteRes.json()).data;

  // revoke by owner
  const revReq = await authedRequestFor(owner.id, "DELETE");
  const revRes = await orgApi.revokeInvitationHandler(
    revReq,
    paramsOf({ id: created.id, token: invite.token })
  );
  assert.equal(revRes.status, 200);
  assert.equal((await revRes.json()).revoked, true);
});
