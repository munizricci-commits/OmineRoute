/**
 * P6.03 — chat-completions: build the org routing context for a chat body.
 * Verifies member → org-scoped context (route + connectionIds),
 * non-member → denied (fail-closed, no org/combo existence reveal),
 * and personal model → unchanged legacy behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-chatq-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const connections = await import("../../src/lib/db/orgConnections.ts");
const authz = await import("../../src/lib/org/authorization.ts");
const qr = await import("../../src/lib/org/qualifiedRoute.ts");

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

function principalFor(userId: string, user: { id: string; status: string; role: string }) {
  return { userId, user, isOrganizationScoped: false } as const;
}

test("member sending team1/combo:dev gets org-scoped context with connection ids", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    slug: "team1",
    name: "Team 1",
    ownerUserId: owner.id,
  });
  const ownerCtx = authz.platformAdminOrganizationContext(org.id); // owner-like for test setup
  await connections.createOrganizationConnection(
    org.id,
    { name: "conn-a", provider: "openai", apiKey: "sk-test" },
    ownerCtx
  );

  const principal = principalFor(owner.id, owner);
  const ctx = await qr.buildOrgRoutingContext({ model: "team1/combo:dev" }, principal);
  assert.equal(ctx.denied, false);
  assert.equal(ctx.organizationId, org.id);
  assert.equal(ctx.route, "combo:dev");
  assert.ok(
    Array.isArray(ctx.connectionIds) && ctx.connectionIds.length === 1,
    "org connections scoped"
  );
});

test("non-member sending team1/combo:dev is denied (fail-closed)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  await orgsDb.createOrganization({ slug: "team1", name: "Team 1", ownerUserId: owner.id });
  const outsider = await usersDb.createUser({ role: "user" });
  const principal = principalFor(outsider.id, outsider);

  const ctx = await qr.buildOrgRoutingContext({ model: "team1/combo:dev" }, principal);
  assert.equal(ctx.denied, true, "non-member must be denied");
  assert.equal(ctx.organizationId, null);
  assert.equal(ctx.connectionIds.length, 0, "no credential scope leak");
});

test("personal model keeps legacy behavior (no org, not denied)", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const principal = principalFor(user.id, user);
  const ctx = await qr.buildOrgRoutingContext({ model: "gpt-4" }, principal);
  assert.equal(ctx.denied, false);
  assert.equal(ctx.organizationId, null);
  assert.equal(ctx.route, "gpt-4");
});

test("provider-prefixed model stays personal, not org-qualified", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const principal = principalFor(user.id, user);
  const ctx = await qr.buildOrgRoutingContext({ model: "openai/gpt-4" }, principal);
  assert.equal(ctx.organizationId, null);
  assert.equal(ctx.route, "openai/gpt-4");
});
