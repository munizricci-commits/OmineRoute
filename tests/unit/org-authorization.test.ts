/**
 * P3.01 (principal-scope-types) — TDD.
 *
 * Covers `resolveOrganizationContext`: type resolution for members of each
 * role, fail-closed `null` for non-members, and `null` for archived orgs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-authz-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const authz = await import("../../src/lib/org/authorization.ts");
const principalMod = await import("../../src/lib/org/principal.ts");

type UserPrincipal = {
  userId: string;
  user: { id: string; role: string; status: string };
  isOrganizationScoped: false;
};

function makePrincipal(
  userId: string,
  user: { id: string; role: string; status: string }
): UserPrincipal {
  return { userId, user, isOrganizationScoped: false };
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

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("resolveOrganizationContext returns owner role for the org owner", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(owner.id, owner as never),
    org.id
  );
  assert.ok(ctx);
  assert.equal(ctx!.organizationId, org.id);
  assert.equal(ctx!.role, "owner");
});

test("resolveOrganizationContext returns user role for an ordinary member", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const member = await usersDb.createUser({ role: "user" });
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

  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(member.id, member as never),
    org.id
  );
  assert.ok(ctx);
  assert.equal(ctx!.organizationId, org.id);
  assert.equal(ctx!.role, "user");
});

test("resolveOrganizationContext returns moderator role for a moderator", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const mod = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });
  await membersDb.addMember({
    organizationId: org.id,
    userId: mod.id,
    role: "moderator",
    actorUserId: owner.id,
  });

  const ctx = await authz.resolveOrganizationContext(makePrincipal(mod.id, mod as never), org.id);
  assert.ok(ctx);
  assert.equal(ctx!.role, "moderator");
});

test("resolveOrganizationContext returns null for a non-member", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const outsider = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(outsider.id, outsider as never),
    org.id
  );
  assert.equal(ctx, null);
});

test("resolveOrganizationContext returns null for an archived org", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });
  await orgsDb.archiveOrganization(org.id);

  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(owner.id, owner as never),
    org.id
  );
  assert.equal(ctx, null, "archived orgs must not resolve a context");
});

test("resolveOrganizationContext returns null for a missing principal", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: owner.id,
  });

  assert.equal(await authz.resolveOrganizationContext(null, org.id), null);
  assert.equal(await authz.resolveOrganizationContext(undefined, org.id), null);
  assert.equal(
    await authz.resolveOrganizationContext(makePrincipal(owner.id, owner as never), ""),
    null,
    "empty org id is fail-closed"
  );
});

test("principal module exposes the expected P1 surface", async () => {
  assert.equal(typeof principalMod.resolveDashboardUserPrincipal, "function");
  assert.equal(typeof principalMod.isPlatformAdmin, "function");
});
