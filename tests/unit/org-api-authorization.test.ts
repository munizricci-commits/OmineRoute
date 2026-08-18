/**
 * P3.03 (api-authorization) — TDD.
 *
 * Proves `resolveOrgAccess` / `requireOrganizationAccess` re-resolve the org from
 * the principal's membership (never trust a client-supplied id) and reject bypass
 * attempts:
 *  - member with the correct capability is allowed,
 *  - a non-member supplying someone else's org id is rejected (404),
 *  - a tampered / unknown org id is rejected (404),
 *  - a member lacking the capability is rejected (403),
 *  - the Request-based `requireOrganizationAccess` enforces the same on a real
 *    session (signed JWT in the dashboard cookie).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-apiauth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const apiAuth = await import("../../src/lib/org/apiAuth.ts");

type StubUser = { id: string; role: string; status: string };
type StubPrincipal = { userId: string; user: StubUser; isOrganizationScoped: false };

function principalOf(u: StubUser): StubPrincipal {
  return { userId: u.id, user: u, isOrganizationScoped: false };
}

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

async function sessionRequestFor(user: StubUser): Promise<Request> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);
  return {
    cookies: {
      get: (name: string) => (name === "auth_token" ? { value: token } : undefined),
    },
  } as unknown as Request;
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("member with the correct capability is allowed", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  const ctx = await apiAuth.resolveOrgAccess(principalOf(owner), org.id, "manageMembership");
  assert.ok(ctx);
  assert.equal(ctx.organizationId, org.id);
  assert.equal(ctx.role, "owner");
});

test("non-member supplying someone else's org id is rejected (404)", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const outsider = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  await assert.rejects(
    () => apiAuth.resolveOrgAccess(principalOf(outsider), org.id, "read"),
    (err: unknown) => {
      const e = err as apiAuth.OrgAccessDeniedError;
      return e instanceof apiAuth.OrgAccessDeniedError && e.status === 404;
    },
    "non-member must be denied without revealing existence"
  );
});

test("tampered / unknown org id is rejected (404)", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  await assert.rejects(
    () => apiAuth.resolveOrgAccess(principalOf(owner), "totally-bogus-org-id", "read"),
    (err: unknown) => {
      const e = err as apiAuth.OrgAccessDeniedError;
      return e instanceof apiAuth.OrgAccessDeniedError && e.status === 404;
    },
    "tampered org id must be denied"
  );
  // sanity: real id (from a member) is allowed
  const ctx = await apiAuth.resolveOrgAccess(principalOf(owner), org.id, "read");
  assert.equal(ctx.organizationId, org.id);
});

test("member lacking the capability is rejected (403)", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const member = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: owner.id,
  });

  await assert.rejects(
    () => apiAuth.resolveOrgAccess(principalOf(member), org.id, "manageMembership"),
    (err: unknown) => {
      const e = err as apiAuth.OrgAccessDeniedError;
      return e instanceof apiAuth.OrgAccessDeniedError && e.status === 403;
    },
    "ordinary member cannot manage membership"
  );
});

test("missing principal is rejected (404)", async () => {
  await assert.rejects(
    () => apiAuth.resolveOrgAccess(null, "whatever", "read"),
    (err: unknown) => {
      const e = err as apiAuth.OrgAccessDeniedError;
      return e instanceof apiAuth.OrgAccessDeniedError && e.status === 404;
    }
  );
});

test("platform_admin override is granted full capabilities via the same predicate", async () => {
  const admin = (await usersDb.createUser({
    role: "platform_admin",
    status: "active",
  })) as StubUser;
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  // admin is NOT a member of this org
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  const ctx = await apiAuth.resolveOrgAccess(principalOf(admin), org.id, "manageMembership");
  assert.equal(ctx.platformAdminOverride, true);
  assert.equal(ctx.organizationId, org.id);
});

test("requireOrganizationAccess allows a session member on a real request", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });
  const request = await sessionRequestFor(owner);

  const ctx = await apiAuth.requireOrganizationAccess(request, org.id, "read");
  assert.equal(ctx.organizationId, org.id);
  assert.equal(ctx.role, "owner");
});

test("requireOrganizationAccess rejects a session non-member on a real request (404)", async () => {
  const owner = (await usersDb.createUser({ role: "user" })) as StubUser;
  const outsider = (await usersDb.createUser({ role: "user" })) as StubUser;
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });
  const request = await sessionRequestFor(outsider);

  await assert.rejects(
    () => apiAuth.requireOrganizationAccess(request, org.id, "read"),
    (err: unknown) => {
      const e = err as apiAuth.OrgAccessDeniedError;
      return e instanceof apiAuth.OrgAccessDeniedError && e.status === 404;
    }
  );
});
