/**
 * P4.02 (organization-connection-crud) — TDD.
 *
 * Covers org-scoped create/get/update/delete over `providers.ts`:
 *  - create stamps organization_id and the connection is returned scoped,
 *  - non-members and non-managers are rejected (fail-closed),
 *  - get-by-id is org-scoped (cross-org id → null),
 *  - update / delete work for managers and touch only the owning org,
 *  - legacy NULL-org (personal) connections are NOT returned by org-scoped reads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p4-crud-"));
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

async function ownerCtxFor() {
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

test("create sets organization_id and the connection is returned org-scoped", async () => {
  const { org, ctx } = await ownerCtxFor();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  );
  assert.equal(conn.organizationId, org.id, "organization_id stamped");
  assert.equal(conn.apiKey, "sk-org-123", "credential preserved on create");

  const list = await orgConn.getOrganizationConnections(org.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, conn.id);
});

test("non-member and non-manager are rejected from create (fail-closed)", async () => {
  const { org } = await ownerCtxFor();

  // Outsider: not a member → resolveOrganizationContext returns null.
  const outsider = await usersDb.createUser({ role: "user" });
  const outsiderCtx = await authz.resolveOrganizationContext(
    makePrincipal(outsider.id, outsider as never),
    org.id
  );
  assert.equal(outsiderCtx, null);
  await assert.rejects(
    () =>
      orgConn.createOrganizationConnection(
        org.id,
        { provider: "openai", authType: "apikey", name: "X", apiKey: "sk-x" },
        outsiderCtx
      ),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED"
  );

  // Plain member (role user) is a member but not a manager.
  const member = await usersDb.createUser({ role: "user" });
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: org.ownerUserId,
  });
  const memberCtx = await authz.resolveOrganizationContext(
    makePrincipal(member.id, member as never),
    org.id
  );
  assert.ok(memberCtx);
  await assert.rejects(
    () =>
      orgConn.createOrganizationConnection(
        org.id,
        { provider: "openai", authType: "apikey", name: "Y", apiKey: "sk-y" },
        memberCtx
      ),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED"
  );
});

test("get-by-id is scoped to the organization (cross-org id returns null)", async () => {
  const { org, ctx } = await ownerCtxFor();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  );
  assert.ok(await orgConn.getOrganizationConnectionById(org.id, conn.id));

  // Different org cannot read it (existence not leaked).
  const other = await ownerCtxFor();
  assert.equal(await orgConn.getOrganizationConnectionById(other.org.id, conn.id), null);
});

test("update works for a manager and preserves the org scope", async () => {
  const { org, ctx } = await ownerCtxFor();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  );
  const updated = await orgConn.updateOrganizationConnection(
    org.id,
    conn.id,
    { name: "Renamed", apiKey: "sk-org-456" },
    ctx
  );
  assert.ok(updated);
  assert.equal(updated!.name, "Renamed");
  assert.equal(updated!.apiKey, "sk-org-456", "updated credential preserved");
  assert.equal(updated!.organizationId, org.id, "org scope preserved across update");

  // Non-manager cannot update.
  const member = await usersDb.createUser({ role: "user" });
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: org.ownerUserId,
  });
  const memberCtx = await authz.resolveOrganizationContext(
    makePrincipal(member.id, member as never),
    org.id
  );
  await assert.rejects(
    () => orgConn.updateOrganizationConnection(org.id, conn.id, { name: "nope" }, memberCtx),
    (e: unknown) => e instanceof orgConn.OrgConnectionError && e.code === "NOT_AUTHORIZED"
  );
});

test("delete works for a manager", async () => {
  const { org, ctx } = await ownerCtxFor();
  const conn = await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  );
  const ok = await orgConn.deleteOrganizationConnection(org.id, conn.id, ctx);
  assert.equal(ok, true);
  assert.equal(await orgConn.getOrganizationConnectionById(org.id, conn.id), null);

  // Deleting a missing connection returns false (not an error).
  assert.equal(await orgConn.deleteOrganizationConnection(org.id, conn.id, ctx), false);
});

test("legacy NULL-org (personal) connections are not returned by org-scoped reads", async () => {
  const { org, ctx } = await ownerCtxFor();
  // Personal connection created via the legacy engine.
  const personal = (await providersDb.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-personal",
  })) as { id: string; organizationId?: string | null };
  assert.equal(personal.organizationId ?? null, null, "legacy connection has NULL org");

  await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  );

  const list = await orgConn.getOrganizationConnections(org.id);
  assert.equal(list.length, 1, "only the org connection is returned");
  assert.equal(list[0].provider, "openai");
});
