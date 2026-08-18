/**
 * P4.03 (connection-transfer) — TDD.
 *
 * Covers `transferConnectionToOrganization`:
 *  - happy personal -> org transfer by a target-org manager,
 *  - reverse org -> personal by the source-org owner,
 *  - rejected when the actor lacks rights (fail-closed),
 *  - idempotent when the connection is already in the target org,
 *  - credential fields are unchanged after transfer (no re-encryption),
 *  - org -> org requires a platform_admin override.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p4-xfer-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const orgConn = await import("../../src/lib/db/orgConnections.ts");
const authz = await import("../../src/lib/org/authorization.ts");

type UserPrincipal = {
  userId: string;
  user: { id: string; role: string; status: string };
  isOrganizationScoped: false;
};

function makePrincipal(userId: string, user: { id: string; role: string; status: string }) {
  return { userId, user, isOrganizationScoped: false as const };
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

/** Create an org owned by a fresh user and return owner ctx + org. */
async function ownerOrg() {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme-" + Math.random().toString(36).slice(2),
    ownerUserId: owner.id,
  });
  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(owner.id, owner as never),
    org.id
  );
  return { owner, org, ctx: ctx! };
}

/** Add a plain (role=user) member to an org and return their ctx. */
async function memberCtx(org: { id: string; ownerUserId: string }) {
  const member = await usersDb.createUser({ role: "user" });
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: org.ownerUserId,
  });
  return (await authz.resolveOrganizationContext(
    makePrincipal(member.id, member as never),
    org.id
  ))!;
}

test("happy personal -> org transfer by a target-org manager", async () => {
  const { org, ctx } = await ownerOrg();
  const personal = (await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-personal-1",
  })) as { id: string; organizationId?: string | null };
  assert.equal(personal.organizationId ?? null, null);

  const transferred = await orgConn.transferConnectionToOrganization(personal.id, org.id, ctx);
  assert.equal(transferred.organizationId, org.id, "connection now belongs to the org");
});

test("reverse org -> personal by the source-org owner", async () => {
  const { org, ctx } = await ownerOrg();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-1" },
    ctx
  );
  assert.equal(conn.organizationId, org.id);

  const back = await orgConn.transferConnectionToOrganization(conn.id, null, ctx);
  assert.equal(back.organizationId ?? null, null, "connection returned to personal");
  assert.equal(back.apiKey, "sk-org-1", "credential intact after reverse transfer");
});

test("rejected when actor lacks rights (fail-closed)", async () => {
  // personal -> org attempted by a plain member of the target org.
  const { org } = await ownerOrg();
  const mCtx = await memberCtx(org);
  const personal = (await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-personal-2",
  })) as { id: string };
  await assert.rejects(
    () => orgConn.transferConnectionToOrganization(personal.id, org.id, mCtx),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED",
    "plain member cannot claim a personal connection"
  );

  // org -> personal attempted by a plain member of the source org.
  const { org: org2, ctx: owner2 } = await ownerOrg();
  const conn2 = await orgConn.createOrganizationConnection(
    org2.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-2" },
    owner2
  );
  const mCtx2 = await memberCtx(org2);
  await assert.rejects(
    () => orgConn.transferConnectionToOrganization(conn2.id, null, mCtx2),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED",
    "plain member cannot move an org connection to personal"
  );

  // Missing context is fail-closed.
  await assert.rejects(
    () => orgConn.transferConnectionToOrganization(conn2.id, null, null),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED"
  );
});

test("idempotent: already-in-org transfer is a clean no-op", async () => {
  const { org, ctx } = await ownerOrg();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-3" },
    ctx
  );
  const again = await orgConn.transferConnectionToOrganization(conn.id, org.id, ctx);
  assert.equal(again.organizationId, org.id, "still in the org");
  assert.equal(again.id, conn.id, "same connection returned");
});

test("credential fields are unchanged after transfer", async () => {
  const { org, ctx } = await ownerOrg();
  const personal = (await providersDb.createProviderConnection({
    provider: "google",
    authType: "oauth",
    name: "OAuth",
    email: "a@b.com",
    accessToken: "at-secret",
    refreshToken: "rt-secret",
    idToken: "idt-secret",
  })) as { id: string };
  const before = (await providersDb.getProviderConnectionById(personal.id)) as Record<
    string,
    unknown
  >;

  const after = (await orgConn.transferConnectionToOrganization(
    personal.id,
    org.id,
    ctx
  )) as Record<string, unknown>;

  assert.equal(after.accessToken, before.accessToken, "accessToken unchanged");
  assert.equal(after.refreshToken, before.refreshToken, "refreshToken unchanged");
  assert.equal(after.idToken, before.idToken, "idToken unchanged");
});

test("org -> org transfer requires a platform_admin override", async () => {
  const src = await ownerOrg();
  const dst = await ownerOrg();
  const conn = await orgConn.createOrganizationConnection(
    src.org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-src" },
    src.ctx
  );
  // Owner of source org (no platform admin override) cannot move it to another org.
  await assert.rejects(
    () => orgConn.transferConnectionToOrganization(conn.id, dst.org.id, src.ctx),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED"
  );

  // With a platform_admin override context scoped to the source org, it succeeds.
  const adminCtx = authz.platformAdminOrganizationContext(src.org.id);
  const moved = await orgConn.transferConnectionToOrganization(conn.id, dst.org.id, adminCtx);
  assert.equal(moved.organizationId, dst.org.id, "platform admin can cross-move");
});
