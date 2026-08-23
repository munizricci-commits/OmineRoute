/**
 * P6.02 — route-resolution: resolve a qualified model to an authorized
 * organization scope + the bare route, fail-closed (Organizations feature).
 *
 * TDD: member resolves org route; non-member → null; unknown slug → null;
 * personal model → no org. Requires a live DB (org + membership).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-routeres-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
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

test("personal model resolves with no organization", async () => {
  const res = await qr.resolveQualifiedRoute(qr.parseQualifiedModel("gpt-4"), null);
  assert.deepEqual(res, { route: "gpt-4" });
});

test("member of org resolves qualified route to organization scope", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    slug: "team1",
    name: "Team 1",
    ownerUserId: owner.id,
  });
  // owner is auto-added as owner member by createOrganization
  const principal = principalFor(owner.id, owner);
  const res = await qr.resolveQualifiedRoute(qr.parseQualifiedModel("team1/combo:dev"), principal);
  assert.ok(res, "member should resolve");
  assert.equal(res!.organizationId, org.id);
  assert.equal((res as { route: string }).route, "combo:dev");
});

test("non-member of org is fail-closed (null)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  await orgsDb.createOrganization({ slug: "team1", name: "Team 1", ownerUserId: owner.id });
  const outsider = await usersDb.createUser({ role: "user" });
  const principal = principalFor(outsider.id, outsider);
  const res = await qr.resolveQualifiedRoute(qr.parseQualifiedModel("team1/combo:dev"), principal);
  assert.equal(res, null, "non-member must not resolve the org route");
});

test("unknown org slug is fail-closed (null, no existence reveal)", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const principal = principalFor(user.id, user);
  const res = await qr.resolveQualifiedRoute(
    qr.parseQualifiedModel("ghost/org/combo:dev".replace("ghost/org/", "ghost/")),
    principal
  );
  assert.equal(res, null);
});

test("archived org is not resolvable by its member (fail-closed)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    slug: "team1",
    name: "Team 1",
    ownerUserId: owner.id,
  });
  await orgsDb.archiveOrganization(org.id);
  const principal = principalFor(owner.id, owner);
  const res = await qr.resolveQualifiedRoute(qr.parseQualifiedModel("team1/combo:dev"), principal);
  assert.equal(res, null, "archived org must not resolve");
});
