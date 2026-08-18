/**
 * P5.04 (combo-resolution-scope) — TDD.
 *
 * `resolveComboInScope` resolves a combo name within the caller's scope:
 *  - a bare name `<comboName>` → a personal combo (organization_id IS NULL);
 *  - a qualified scope `{organizationId, name}` → that org's combo, but ONLY
 *    when the caller is a member of that org (fail-closed: non-member → null,
 *    no existence reveal);
 *  - an org combo is NOT resolvable by a bare name (even by the org's own
 *    members).
 *
 * The P6.01 layer parses `<orgSlug>/<comboName>` into `{organizationId, name}`;
 * this module consumes the already-parsed scope.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p5-resolve-"));
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

async function orgComboFor(org: { id: string }, ctx: never, name: string) {
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-org-123" },
    ctx
  )) as { id: string };
  return orgCombos.createOrganizationCombo(
    org.id,
    { name, models: [{ connectionId: conn.id, provider: "openai", model: "gpt-4o", step: 0 }] },
    ctx
  );
}

test("bare name resolves to a personal combo", async () => {
  const personal = await combosDb.createCombo({
    name: "personal-combo",
    models: [{ connectionId: "conn-p", provider: "openai", model: "gpt-4o", step: 0 }],
  });

  const resolved = await orgCombos.resolveComboInScope({ name: "personal-combo" }, null);
  assert.ok(resolved);
  assert.equal(resolved!.id, personal.id);
  assert.equal(resolved!.organizationId ?? null, null, "resolved combo is personal");
});

test("qualified scope resolves to an org combo for a member", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const combo = await orgComboFor(org, ctx as never, "org-combo");

  const resolved = await orgCombos.resolveComboInScope(
    { organizationId: org.id, name: "org-combo" },
    ctx
  );
  assert.ok(resolved);
  assert.equal(resolved!.id, combo.id);
  assert.equal(resolved!.organizationId, org.id);
});

test("qualified scope returns null for a non-member (fail-closed)", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  await orgComboFor(org, ctx as never, "org-combo");

  // Outsider: not a member → context is null.
  const resolvedNull = await orgCombos.resolveComboInScope(
    { organizationId: org.id, name: "org-combo" },
    null
  );
  assert.equal(resolvedNull, null, "non-member (null ctx) learns nothing");

  // Member of a DIFFERENT org: context org id mismatch.
  const other = await ownerCtxFor("b");
  const resolvedOther = await orgCombos.resolveComboInScope(
    { organizationId: org.id, name: "org-combo" },
    other.ctx
  );
  assert.equal(resolvedOther, null, "cross-org member learns nothing");
});

test("org combo is NOT resolvable by a bare name (even by its own members)", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  await orgComboFor(org, ctx as never, "org-combo");

  // A member of org A doing a bare lookup must NOT see the org combo.
  const resolved = await orgCombos.resolveComboInScope({ name: "org-combo" }, ctx);
  assert.equal(resolved, null, "bare name never resolves an org-scoped combo");

  // And a member of another org doing a bare lookup also gets null.
  const other = await ownerCtxFor("b");
  const resolvedOther = await orgCombos.resolveComboInScope({ name: "org-combo" }, other.ctx);
  assert.equal(resolvedOther, null);
});
