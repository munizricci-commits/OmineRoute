/**
 * P5.02 (combo-resource-validation) — TDD.
 *
 * `validateComboTargets` enforces Invariant #8: an org-combo may ONLY reference
 * org-scoped connections belonging to the SAME organization. A NULL-org
 * (personal) combo may reference any connection (legacy behavior).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p5-validate-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const orgConn = await import("../../src/lib/db/orgConnections.ts");
const authz = await import("../../src/lib/org/authorization.ts");
const comboScope = await import("../../src/lib/org/comboScope.ts");

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

// Build a combo-shaped object referencing the given connection ids.
function comboWithTargets(...connectionIds: string[]) {
  return {
    name: "c-" + connectionIds.join("-"),
    models: connectionIds.map((id, i) => ({
      connectionId: id,
      provider: "openai",
      model: "gpt-4o",
      step: i,
    })),
  };
}

test("org-combo referencing a same-org connection is accepted", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-test-secret" },
    ctx
  )) as { id: string };

  const combo = comboWithTargets(conn.id);
  await assert.doesNotReject(() => comboScope.validateComboTargets(combo, org.id));
});

test("org-combo referencing a personal connection is rejected", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const personal = (await providersDb.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-test-secret",
  })) as { id: string };

  const combo = comboWithTargets(personal.id);
  await assert.rejects(
    () => comboScope.validateComboTargets(combo, org.id),
    (e: unknown) => e instanceof comboScope.ComboScopeError && e.code === "INVALID_TARGET"
  );
});

test("org-combo referencing a different-org connection is rejected", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const other = await ownerCtxFor("b");
  const otherConn = (await orgConn.createOrganizationConnection(
    other.org.id,
    { provider: "openai", authType: "apikey", name: "Other Org Key", apiKey: "sk-other-123" },
    other.ctx
  )) as { id: string };

  const combo = comboWithTargets(otherConn.id);
  await assert.rejects(
    () => comboScope.validateComboTargets(combo, org.id),
    (e: unknown) => e instanceof comboScope.ComboScopeError && e.code === "INVALID_TARGET"
  );
});

test("personal (NULL-org) combo referencing any connection is accepted", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const orgConnRow = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-test-secret" },
    ctx
  )) as { id: string };
  const personal = (await providersDb.createProviderConnection({
    provider: "anthropic",
    authType: "apikey",
    name: "Personal",
    apiKey: "sk-test-secret",
  })) as { id: string };

  // NULL org → references to both org and personal connections are allowed.
  const combo = comboWithTargets(orgConnRow.id, personal.id);
  await assert.doesNotReject(() => comboScope.validateComboTargets(combo, null));
  await assert.doesNotReject(() => comboScope.validateComboTargets(combo, undefined as never));
});

test("org-combo referencing a connection via allowedConnectionIds is validated", async () => {
  const { org, ctx } = await ownerCtxFor("a");
  const conn = (await orgConn.createOrganizationConnection(
    org.id,
    { provider: "openai", authType: "apikey", name: "Org Key", apiKey: "sk-test-secret" },
    ctx
  )) as { id: string };

  const combo = {
    name: "fanout",
    models: [
      {
        provider: "openai",
        model: "gpt-4o",
        step: 0,
        allowedConnectionIds: [conn.id],
      },
    ],
  };
  await assert.doesNotReject(() => comboScope.validateComboTargets(combo, org.id));

  const bad = {
    name: "fanout-bad",
    models: [
      {
        provider: "openai",
        model: "gpt-4o",
        step: 0,
        allowedConnectionIds: ["conn-does-not-exist"],
      },
    ],
  };
  await assert.rejects(
    () => comboScope.validateComboTargets(bad, org.id),
    (e: unknown) => e instanceof comboScope.ComboScopeError && e.code === "INVALID_TARGET"
  );
});
