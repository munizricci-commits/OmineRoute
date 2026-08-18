/**
 * P2.01 — organization-schema: organizations table + owner-membership invariant.
 *
 * TDD: covers happy path (create returns id+slug, inserts owner membership),
 * slug uniqueness (DB-enforced), read-by-id/slug, update, archive status flip,
 * delete (cascades members), and a backward-compatibility regression asserting
 * that legacy personal config (no org rows) is completely unaffected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-orgs-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const usersDb = await import("../../src/lib/db/users.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

async function makeOwner(): Promise<string> {
  const user = await usersDb.createUser({ email: `owner-${uuid()}` });
  return user.id;
}
function uuid(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("createOrganization returns id+slug and inserts an owner membership", async () => {
  const ownerId = await makeOwner();
  const org = await orgsDb.createOrganization({
    name: "Acme",
    slug: "acme",
    ownerUserId: ownerId,
  });

  assert.ok(org.id, "id generated");
  assert.equal(org.slug, "acme");
  assert.equal(org.name, "Acme");
  assert.equal(org.ownerUserId, ownerId);
  assert.equal(org.status, "active");
  assert.ok(org.createdAt && org.updatedAt);

  // Owner membership row must exist with role=owner.
  const db = core.getDbInstance();
  const member = db
    .prepare(`SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ?`)
    .get(org.id, ownerId) as Record<string, unknown> | undefined;
  assert.ok(member, "owner membership row created");
  assert.equal(member!.role, "owner");
  assert.equal(member!.status, "active");
});

test("slug uniqueness is enforced", async () => {
  const ownerId = await makeOwner();
  await orgsDb.createOrganization({ name: "Acme", slug: "acme", ownerUserId: ownerId });

  await assert.rejects(
    () => orgsDb.createOrganization({ name: "Acme2", slug: "acme", ownerUserId: ownerId }),
    (err: Error) => {
      assert.ok(err instanceof orgsDb.OrganizationError);
      assert.equal((err as orgsDb.OrganizationError).code, "SLUG_EXISTS");
      return true;
    }
  );
});

test("getOrganizationById and getOrganizationBySlug round-trip", async () => {
  const ownerId = await makeOwner();
  const created = await orgsDb.createOrganization({
    name: "Globex",
    slug: "globex",
    ownerUserId: ownerId,
  });

  const byId = await orgsDb.getOrganizationById(created.id);
  assert.ok(byId);
  assert.equal(byId!.id, created.id);

  const bySlug = await orgsDb.getOrganizationBySlug("GLOBEX"); // case-insensitive normalization
  assert.ok(bySlug);
  assert.equal(bySlug!.id, created.id);

  assert.equal(await orgsDb.getOrganizationById("nope"), null);
  assert.equal(await orgsDb.getOrganizationBySlug("nope"), null);
});

test("updateOrganization changes mutable fields", async () => {
  const ownerId = await makeOwner();
  const org = await orgsDb.createOrganization({
    name: "Old",
    slug: "old",
    ownerUserId: ownerId,
  });

  const updated = await orgsDb.updateOrganization(org.id, { name: "New", slug: "new" });
  assert.ok(updated);
  assert.equal(updated!.name, "New");
  assert.equal(updated!.slug, "new");
  assert.ok(new Date(updated!.updatedAt).getTime() >= new Date(org.updatedAt).getTime());
});

test("archiveOrganization flips status to archived", async () => {
  const ownerId = await makeOwner();
  const org = await orgsDb.createOrganization({
    name: "Temp",
    slug: "temp",
    ownerUserId: ownerId,
  });

  const archived = await orgsDb.archiveOrganization(org.id);
  assert.ok(archived);
  assert.equal(archived!.status, "archived");

  // archived org is no longer returned by default active listing
  const active = await orgsDb.listOrganizations();
  assert.equal(
    active.find((o) => o.id === org.id),
    undefined,
    "archived org excluded from active listing"
  );
  const all = await orgsDb.listOrganizations({ status: "all" });
  assert.ok(
    all.find((o) => o.id === org.id),
    "archived org present in status=all"
  );
});

test("deleteOrganization removes the org and its members", async () => {
  const ownerId = await makeOwner();
  const org = await orgsDb.createOrganization({
    name: "Doomed",
    slug: "doomed",
    ownerUserId: ownerId,
  });

  const deleted = await orgsDb.deleteOrganization(org.id);
  assert.equal(deleted, true);
  assert.equal(await orgsDb.getOrganizationById(org.id), null);

  const db = core.getDbInstance();
  const members = db
    .prepare(`SELECT COUNT(*) AS c FROM organization_members WHERE organization_id = ?`)
    .get(org.id) as { c: number };
  assert.equal(members.c, 0, "members cascade-deleted");
});

test("regression: legacy personal config (no org rows) is unaffected", async () => {
  // Fresh DB: zero orgs, zero members — personal config untouched.
  const all = await orgsDb.listOrganizations({ status: "all" });
  assert.equal(all.length, 0);

  // A legacy-style personal user still works without any org.
  const user = await usersDb.createUser({ email: "legacy@example.com" });
  assert.ok(user.id);

  const db = core.getDbInstance();
  const orgCount = db.prepare(`SELECT COUNT(*) AS c FROM organizations`).get() as { c: number };
  const memberCount = db.prepare(`SELECT COUNT(*) AS c FROM organization_members`).get() as {
    c: number;
  };
  assert.equal(orgCount.c, 0);
  assert.equal(memberCount.c, 0);
});
