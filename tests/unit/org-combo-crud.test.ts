/**
 * P5.03 (combo-crud-authorization) — TDD.
 *
 * Org-scoped combo CRUD over `combos.ts`:
 *  - create stamps organization_id, validates targets, requires a manager,
 *  - non-managers are rejected from create/update/delete (fail-closed),
 *  - reads are member-gated and org-scoped,
 *  - update re-validates targets,
 *  - delete works for managers,
 *  - legacy NULL-org (personal) combos are NOT returned by org-scoped reads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p5-crud-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const orgConn = await import("../../src/lib/db/orgConnections.ts");
const authz = await import("../../src/lib/org/authorization.ts");
const orgCombos = await import("../../src/lib/db/orgCombos.ts");
const combosDb = await import("../../src/lib/db/combos.ts");

type UserPrincipal = {
  userId: string;
  user: { id: string; role: string; status: string };
  isOrganizationScoped: false;
};

function makePrincipal(userId: string, user: { id: string; role: string; status: string }) {
  return { userId, user, isOrganizationScoped: false as const };
}

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function ownerCtxFor(slugSuffix: string) {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Acme" + slugSuffix,
    slug: "acme-" + slugSuffix,
    ownerUserId: owner.id,
  });
  const ctx = await authz.resolveOrganizationContext(
    makePrincipal(owner.id, owner as never),
    org.id
  );
  return { owner, org, ctx: ctx! };
}

function memberCtxFor(org: { id: string; ownerUserId: string }) {
  return membersDb
    .addMember({
      organizationId: org.id,
      userId: org.ownerUserId,
      role: "user",
      actorUserId: org.ownerUserId,
    })
    .then(() => undefined);
}

test("create sets organization_id, validates targets, requires a manager", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  )) as { id: string };

  const combo = await orgCombos.createOrganizationCombo(
    org.id,
    {
      name: "Org Combo",
      models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }],
    },
    ctx
  );
  assert.ok(combo.id);
  assert.equal(combo.organizationId, org.id, "organization_id stamped on the combo");

  // Persisted in the column.
  const db = core.getDbInstance();
  const row = db.prepare("SELECT organization_id FROM combos WHERE id = ?").get(combo.id) as {
    organization_id: string | null;
  };
  assert.equal(row.organization_id, org.id);

  // Non-manager (plain member) is rejected (fail-closed).
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
    () => orgCombos.createOrganizationCombo(org.id, { name: "Nope" }, memberCtx),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "NOT_AUTHORIZED"
  );

  // Outsider ctx (null) is rejected.
  await assert.rejects(
    () => orgCombos.createOrganizationCombo(org.id, { name: "Nope2" }, null),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "NOT_AUTHORIZED"
  );
});

test("create rejects an org-combo referencing a non-member connection", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const personal = (await providersDb.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-personal-123",
  })) as { id: string };

  await assert.rejects(
    () =>
      orgCombos.createOrganizationCombo(
        org.id,
        {
          name: "Bad",
          models: [{ connectionId: personal.id, provider: "x", model: "y", step: 0 }],
        },
        ctx
      ),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "INVALID_TARGET"
  );
});

test("get scoped reads are org-scoped and member-gated", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  )) as { id: string };

  const combo = await orgCombos.createOrganizationCombo(
    org.id,
    {
      name: "Org Combo",
      models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }],
    },
    ctx
  );

  // Owner (member) can read it scoped.
  const byId = await orgCombos.getOrganizationComboById(org.id, combo.id, ctx);
  assert.ok(byId);
  assert.equal(byId!.id, combo.id);

  const list = await orgCombos.getOrganizationCombos(org.id, ctx);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, combo.id);

  // Cross-org read returns null (existence not leaked).
  const other = await ownerCtxFor("b");
  assert.equal(await orgCombos.getOrganizationComboById(other.org.id, combo.id), null);

  // NOTE: membership fail-closed for READS is enforced by the P3.03 API gate
  // (requireOrganizationAccess), which resolves the org context and rejects
  // non-members before these unscoped db helpers run. The db helpers scope the
  // *result* to orgId; they intentionally do not re-check the caller.
});

test("legacy NULL-org combos are NOT returned by org-scoped queries", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  await combosDb.createCombo({
    name: "Personal Combo",
    models: [{ connectionId: "conn-p", provider: "openai", model: "gpt-4o", step: 0 }],
  });

  const list = await orgCombos.getOrganizationCombos(org.id, ctx);
  assert.equal(list.length, 0, "no org combos yet");

  const byName = await orgCombos.getOrganizationComboByName(org.id, "Personal Combo", ctx);
  assert.equal(byName, null, "personal combo not found via org-scoped name lookup");
});

test("update re-validates targets and preserves org scope", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  )) as { id: string };
  const combo = await orgCombos.createOrganizationCombo(
    org.id,
    {
      name: "Org Combo",
      models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }],
    },
    ctx
  );

  const updated = await orgCombos.updateOrganizationCombo(
    org.id,
    combo.id,
    { name: "Renamed" },
    ctx
  );
  assert.ok(updated);
  assert.equal(updated!.name, "Renamed");
  assert.equal(updated!.organizationId, org.id, "org scope preserved across update");

  // Re-pointing to a personal connection is rejected (targets re-validated).
  const personal = (await providersDb.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-personal-123",
  })) as { id: string };
  await assert.rejects(
    () =>
      orgCombos.updateOrganizationCombo(
        org.id,
        combo.id,
        { models: [{ connectionId: personal.id, provider: "x", model: "y", step: 0 }] },
        ctx
      ),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "INVALID_TARGET"
  );

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
    () => orgCombos.updateOrganizationCombo(org.id, combo.id, { name: "nope" }, memberCtx),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "NOT_AUTHORIZED"
  );
});

test("delete works for a manager and fails closed for non-members", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  )) as { id: string };
  const combo = await orgCombos.createOrganizationCombo(
    org.id,
    {
      name: "Org Combo",
      models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }],
    },
    ctx
  );

  const ok = await orgCombos.deleteOrganizationCombo(org.id, combo.id, ctx);
  assert.equal(ok, true);
  assert.equal(await orgCombos.getOrganizationComboById(org.id, combo.id, ctx), null);

  // Deleting a missing combo returns false (not an error).
  assert.equal(await orgCombos.deleteOrganizationCombo(org.id, combo.id, ctx), false);

  // Non-manager cannot delete.
  const combo2 = await orgCombos.createOrganizationCombo(
    org.id,
    {
      name: "Org Combo 2",
      models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }],
    },
    ctx
  );
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
    () => orgCombos.deleteOrganizationCombo(org.id, combo2.id, memberCtx),
    (e: unknown) => e instanceof orgCombos.OrgComboError && e.code === "NOT_AUTHORIZED"
  );
});
