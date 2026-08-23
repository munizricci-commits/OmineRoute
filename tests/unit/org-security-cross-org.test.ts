/**
 * P11.01 — cross-organization security matrix. Proves Org A members cannot
 * read/write Org B's members, connections, combos, quota, or resolve Org B's
 * qualified routes. Server-side authz (P3 resolveOrgAccess) is the only
 * boundary; failures must be fail-closed (404 / 403) and never reveal Org B
 * data to Org A.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec-xorg-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret-cross-org";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const invDb = await import("../../src/lib/db/invitations.ts");
const orgQuotas = await import("../../src/lib/db/orgQuotas.ts");
const api = await import("../../src/lib/org/orgApiService.ts");
const qr = await import("../../src/lib/org/qualifiedRoute.ts");

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

async function authedGet(userId: string, url: string): Promise<Request> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .sign(secret);
  return new Request(url, {
    method: "GET",
    headers: { Cookie: `auth_token=${token}` },
  });
}
async function authedPost(userId: string, url: string, body: unknown): Promise<Request> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .sign(secret);
  return new Request(url, {
    method: "POST",
    headers: { Cookie: `auth_token=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function p(id: string) {
  return { params: Promise.resolve({ id }) } as { params: Promise<{ id: string }> };
}

test("setup: build two orgs with one shared member only in Org A", async () => {
  const aOwner = await usersDb.createUser({ role: "user" });
  const bOwner = await usersDb.createUser({ role: "user" });
  const aMember = await usersDb.createUser({ role: "user" });

  const orgA = await orgsDb.createOrganization({
    name: "Team A",
    slug: "teama",
    ownerUserId: aOwner.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "Team B",
    slug: "teamb",
    ownerUserId: bOwner.id,
  });
  await membersDb.addMember({
    organizationId: orgA.id,
    userId: aMember.id,
    role: "user",
    actorUserId: aOwner.id,
  });
  // aMember is NOT in orgB.
  const ctxA = await qr.buildOrgRoutingContext(
    { model: "teamb/combo:dev" },
    { userId: aMember.id, user: aMember, isOrganizationScoped: false }
  );
  assert.equal(ctxA.denied, true, "member of A resolving teamb route must be denied");
  const ctxApersonal = await qr.buildOrgRoutingContext(
    { model: "teama/combo:dev" },
    { userId: aMember.id, user: aMember, isOrganizationScoped: false }
  );
  assert.equal(ctxApersonal.denied, false, "member of A resolving teama route resolved");
});

test("Org A member cannot read Org B members (fail-closed 404)", async () => {
  const aOwner = await usersDb.createUser({ role: "user" });
  const bOwner = await usersDb.createUser({ role: "user" });
  const aMember = await usersDb.createUser({ role: "user" });
  const orgA = await orgsDb.createOrganization({
    name: "A",
    slug: "teama",
    ownerUserId: aOwner.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "B",
    slug: "teamb",
    ownerUserId: bOwner.id,
  });
  await membersDb.addMember({
    organizationId: orgA.id,
    userId: aMember.id,
    role: "user",
    actorUserId: aOwner.id,
  });

  const req = await authedGet(aMember.id, `http://localhost/api/organizations/${orgB.id}/members`);
  const res = await api.listMembersHandler(req, p(orgB.id));
  assert.equal(res.status, 404, "non-member must not resolve org B members");
});

test("Org A member cannot read Org B connections or combos", async () => {
  const aOwner = await usersDb.createUser({ role: "user" });
  const bOwner = await usersDb.createUser({ role: "user" });
  const aMember = await usersDb.createUser({ role: "user" });
  const orgA = await orgsDb.createOrganization({
    name: "A",
    slug: "teama",
    ownerUserId: aOwner.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "B",
    slug: "teamb",
    ownerUserId: bOwner.id,
  });
  await membersDb.addMember({
    organizationId: orgA.id,
    userId: aMember.id,
    role: "user",
    actorUserId: aOwner.id,
  });

  const cReq = await authedGet(
    aMember.id,
    `http://localhost/api/organizations/${orgB.id}/connections`
  );
  const cRes = await api.listConnectionsHandler(cReq, p(orgB.id));
  assert.equal(cRes.status, 404, "non-member must not resolve org B connections");

  const comboReq = await authedGet(
    aMember.id,
    `http://localhost/api/organizations/${orgB.id}/combos`
  );
  const comboRes = await api.listCombosHandler(comboReq, p(orgB.id));
  assert.equal(comboRes.status, 404, "non-member must not resolve org B combos");
});

test("Org A member cannot write Org B (invitations/members -> 403/404)", async () => {
  const aOwner = await usersDb.createUser({ role: "user" });
  const bOwner = await usersDb.createUser({ role: "user" });
  const aMember = await usersDb.createUser({ role: "user" });
  const orgA = await orgsDb.createOrganization({
    name: "A",
    slug: "teama",
    ownerUserId: aOwner.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "B",
    slug: "teamb",
    ownerUserId: bOwner.id,
  });
  await membersDb.addMember({
    organizationId: orgA.id,
    userId: aMember.id,
    role: "user",
    actorUserId: aOwner.id,
  });

  const invReq = await authedPost(
    aMember.id,
    `http://localhost/api/organizations/${orgB.id}/invitations`,
    {
      email: "x@y.z",
      role: "user",
    }
  );
  const invRes = await api.createInvitationHandler(invReq, p(orgB.id));
  assert.ok(invRes.status === 403 || invRes.status === 404, "non-member cannot invite into org B");

  const memReq = await authedPost(
    aMember.id,
    `http://localhost/api/organizations/${orgB.id}/members`,
    {
      userId: aMember.id,
      role: "user",
    }
  );
  const memRes = await api.addMemberHandler(memReq, p(orgB.id));
  assert.ok(memRes.status === 403 || memRes.status === 404, "non-member cannot add into org B");
});

test("Org A owner setting Org B quota is rejected (403)", async () => {
  const aOwner = await usersDb.createUser({ role: "user" });
  const bOwner = await usersDb.createUser({ role: "user" });
  const orgA = await orgsDb.createOrganization({
    name: "A",
    slug: "teama",
    ownerUserId: aOwner.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "B",
    slug: "teamb",
    ownerUserId: bOwner.id,
  });

  const req = await authedPost(aOwner.id, `http://localhost/api/organizations/${orgB.id}/quota`, {
    limit: 10,
    window: "daily",
    scope: "requests",
  });
  const res = await api.setOrganizationQuotaHandler(req, p(orgB.id));
  assert.equal(res.status, 404, "org A owner cannot set org B quota (fail-closed)");
  const bQuota = await orgQuotas.getOrganizationQuota(orgB.id);
  assert.equal(bQuota, null, "org B quota must remain unset");
});
