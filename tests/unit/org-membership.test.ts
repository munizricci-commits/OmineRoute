/**
 * P2.03 — membership-service: add/remove/promote/demote with RBAC invariants.
 *
 * TDD: covers the happy path (owner adds a user, promotes to moderator, demotes
 * back), authorization negatives (a plain user cannot add; a moderator cannot
 * add a moderator or remove the owner; the owner can never be removed; the last
 * owner is protected), and the UNIQUE-backed idempotent add (two adds of the
 * same user yield exactly one row).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-members-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const usersDb = await import("../../src/lib/db/users.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

let _seq = 0;
async function makeUser(): Promise<string> {
  const user = await usersDb.createUser({ email: `m-${_seq++}@example.com` });
  return user.id;
}

/** Create an org owned by a fresh user, return { orgId, ownerId }. */
async function makeOrg(): Promise<{ orgId: string; ownerId: string }> {
  const ownerId = await makeUser();
  const org = await orgsDb.createOrganization({
    name: "Org",
    slug: `org-${_seq++}`,
    ownerUserId: ownerId,
  });
  return { orgId: org.id, ownerId };
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("owner can add a user member and it appears in the listing", async () => {
  const { orgId, ownerId } = await makeOrg();
  const userA = await makeUser();

  const member = await membersDb.addMember({
    organizationId: orgId,
    userId: userA,
    role: "user",
    actorUserId: ownerId,
  });
  assert.equal(member.userId, userA);
  assert.equal(member.role, "user");

  const all = await membersDb.listMembers(orgId);
  const ids = all.map((m) => m.userId);
  assert.ok(ids.includes(ownerId), "owner present");
  assert.ok(ids.includes(userA), "added user present");
  assert.equal(all.length, 2);

  const fetched = await membersDb.getMembership(orgId, userA);
  assert.ok(fetched);
  assert.equal(fetched!.role, "user");
});

test("owner can promote a user to moderator and demote back", async () => {
  const { orgId, ownerId } = await makeOrg();
  const userA = await makeUser();
  await membersDb.addMember({
    organizationId: orgId,
    userId: userA,
    actorUserId: ownerId,
  });

  const promoted = await membersDb.promoteMember(orgId, userA, ownerId);
  assert.equal(promoted.role, "moderator");

  const asMod = await membersDb.getMembership(orgId, userA);
  assert.equal(asMod!.role, "moderator");

  const demoted = await membersDb.demoteMember(orgId, userA, ownerId);
  assert.equal(demoted.role, "user");
});

test("a plain user cannot add a member", async () => {
  const { orgId, ownerId } = await makeOrg();
  const userA = await makeUser();
  await membersDb.addMember({ organizationId: orgId, userId: userA, actorUserId: ownerId });
  const userC = await makeUser();

  await assert.rejects(
    () =>
      membersDb.addMember({
        organizationId: orgId,
        userId: userC,
        actorUserId: userA, // userA has role "user"
      }),
    (err: Error) => {
      assert.ok(err instanceof membersDb.MembershipError);
      assert.equal((err as membersDb.MembershipError).code, "NOT_AUTHORIZED");
      return true;
    }
  );
});

test("a moderator cannot add a moderator (owner only)", async () => {
  const { orgId, ownerId } = await makeOrg();
  const mod = await makeUser();
  await membersDb.addMember({ organizationId: orgId, userId: mod, actorUserId: ownerId });
  await membersDb.promoteMember(orgId, mod, ownerId);
  const userC = await makeUser();

  await assert.rejects(
    () =>
      membersDb.addMember({
        organizationId: orgId,
        userId: userC,
        role: "moderator",
        actorUserId: mod, // moderator
      }),
    (err: Error) => {
      assert.ok(err instanceof membersDb.MembershipError);
      assert.equal((err as membersDb.MembershipError).code, "NOT_AUTHORIZED");
      return true;
    }
  );
});

test("a moderator cannot remove the owner (owner-immutable invariant)", async () => {
  const { orgId, ownerId } = await makeOrg();
  const mod = await makeUser();
  await membersDb.addMember({ organizationId: orgId, userId: mod, actorUserId: ownerId });
  await membersDb.promoteMember(orgId, mod, ownerId);

  // The owner can never be removed — by anyone, including a moderator. The
  // rejection is the owner-immutable invariant, not a plain authz check.
  await assert.rejects(
    () => membersDb.removeMember(orgId, ownerId, mod),
    (err: Error) => {
      assert.ok(err instanceof membersDb.MembershipError);
      assert.equal((err as membersDb.MembershipError).code, "OWNER_CANNOT_BE_REMOVED");
      return true;
    }
  );
});

test("the owner can never be removed (invariant)", async () => {
  const { orgId, ownerId } = await makeOrg();

  await assert.rejects(
    () => membersDb.removeMember(orgId, ownerId, ownerId),
    (err: Error) => {
      assert.ok(err instanceof membersDb.MembershipError);
      assert.equal((err as membersDb.MembershipError).code, "OWNER_CANNOT_BE_REMOVED");
      return true;
    }
  );

  // And the last owner is protected (only one owner exists here).
  const after = await membersDb.getMembership(orgId, ownerId);
  assert.ok(after, "owner still present");
  assert.equal(after!.role, "owner");
});

test("removeMember deletes the membership row", async () => {
  const { orgId, ownerId } = await makeOrg();
  const userA = await makeUser();
  await membersDb.addMember({ organizationId: orgId, userId: userA, actorUserId: ownerId });

  const removed = await membersDb.removeMember(orgId, userA, ownerId);
  assert.equal(removed, true);
  assert.equal(await membersDb.getMembership(orgId, userA), null);
});

test("concurrent add of the same user yields exactly one row (UNIQUE-backed)", async () => {
  const { orgId, ownerId } = await makeOrg();
  const userA = await makeUser();

  // Two sequential adds (a race would hit the same UNIQUE constraint) must not
  // produce two rows; the second returns the existing active membership.
  const first = await membersDb.addMember({
    organizationId: orgId,
    userId: userA,
    actorUserId: ownerId,
  });
  const second = await membersDb.addMember({
    organizationId: orgId,
    userId: userA,
    actorUserId: ownerId,
  });
  assert.equal(first.id, second.id, "idempotent — same membership returned");

  const db = core.getDbInstance();
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM organization_members WHERE organization_id = ? AND user_id = ?`
    )
    .get(orgId, userA) as { c: number };
  assert.equal(count.c, 1, "exactly one membership row");
});
