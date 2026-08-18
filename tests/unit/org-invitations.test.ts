/**
 * P2.04 — invitation-lifecycle: create/accept/revoke with replay protection.
 *
 * TDD: covers happy path (create -> accept materializes a membership), the
 * single-use replay boundary (a second accept of the same token is rejected
 * and creates NO second membership), revoke (rejected acceptance), expiry
 * (lazy-marked + rejected), token/record lookups, listing, and the
 * owner/moderator-only authorization on issue/revoke.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-invites-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const invitesDb = await import("../../src/lib/db/invitations.ts");
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
  const user = await usersDb.createUser({ email: `i-${_seq++}@example.com` });
  return user.id;
}

async function makeOrg(): Promise<{ orgId: string; ownerId: string }> {
  const ownerId = await makeUser();
  const org = await orgsDb.createOrganization({
    name: "InviteOrg",
    slug: `invite-org-${_seq++}`,
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

test("createInvitation generates a unique token and a future expiry", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "Invitee@example.com",
    role: "user",
    invitedBy: ownerId,
  });

  assert.ok(invite.token, "token generated");
  assert.equal(invite.token.length, 64, "token is 32 random bytes hex");
  assert.equal(invite.email, "invitee@example.com", "email normalized to lowercase");
  assert.equal(invite.status, "pending");
  assert.ok(new Date(invite.expiresAt).getTime() > Date.now(), "expiry in the future");

  const db = core.getDbInstance();
  const count = db
    .prepare(`SELECT COUNT(*) AS c FROM organization_invitations WHERE token = ?`)
    .get(invite.token) as { c: number };
  assert.equal(count.c, 1);
});

test("acceptInvitation materializes a membership and marks the invite accepted", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invitee = await makeUser();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "invitee@example.com",
    role: "user",
    invitedBy: ownerId,
  });

  const membership = await invitesDb.acceptInvitation(invite.token, invitee);
  assert.ok(membership, "membership created");
  assert.equal(membership!.userId, invitee);
  assert.equal(membership!.organizationId, orgId);
  assert.equal(membership!.role, "user");

  const after = await invitesDb.getInvitationByToken(invite.token);
  assert.ok(after);
  assert.equal(after!.status, "accepted");
});

test("replay protection: accepting the same token twice creates only one membership", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invitee = await makeUser();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "invitee@example.com",
    invitedBy: ownerId,
  });

  const first = await invitesDb.acceptInvitation(invite.token, invitee);
  assert.ok(first);
  const second = await invitesDb.acceptInvitation(invite.token, invitee);
  assert.equal(second, null, "replay rejected");

  const db = core.getDbInstance();
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM organization_members WHERE organization_id = ? AND user_id = ?`
    )
    .get(orgId, invitee) as { c: number };
  assert.equal(count.c, 1, "exactly one membership row");
});

test("revoked invitations cannot be accepted", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invitee = await makeUser();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "invitee@example.com",
    invitedBy: ownerId,
  });

  const revoked = await invitesDb.revokeInvitation(invite.token, ownerId);
  assert.equal(revoked, true);

  const membership = await invitesDb.acceptInvitation(invite.token, invitee);
  assert.equal(membership, null, "revoked token rejected");
});

test("expired invitations are lazily marked and rejected", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invitee = await makeUser();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "invitee@example.com",
    invitedBy: ownerId,
    expiresInMs: 1, // already expired after a tick
  });
  await new Promise((r) => setTimeout(r, 5));

  const membership = await invitesDb.acceptInvitation(invite.token, invitee);
  assert.equal(membership, null, "expired token rejected");

  const after = await invitesDb.getInvitationByToken(invite.token);
  assert.equal(after!.status, "expired", "lazily marked expired");
});

test("getInvitationByToken and listInvitations reflect status", async () => {
  const { orgId, ownerId } = await makeOrg();
  const invitee = await makeUser();
  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "invitee@example.com",
    invitedBy: ownerId,
  });

  assert.ok(await invitesDb.getInvitationByToken(invite.token));
  assert.equal(await invitesDb.getInvitationByToken("bogus"), null);

  const pending = await invitesDb.listInvitations(orgId, { status: "pending" });
  assert.equal(pending.length, 1);

  await invitesDb.acceptInvitation(invite.token, invitee);
  const accepted = await invitesDb.listInvitations(orgId, { status: "accepted" });
  assert.equal(accepted.length, 1);

  const all = await invitesDb.listInvitations(orgId);
  assert.equal(all.length, 1);
});

test("only an owner or moderator may create or revoke invitations", async () => {
  const { orgId, ownerId } = await makeOrg();
  const plainUser = await makeUser();
  await membersDb.addMember({ organizationId: orgId, userId: plainUser, actorUserId: ownerId });

  await assert.rejects(
    () =>
      invitesDb.createInvitation({
        organizationId: orgId,
        email: "x@example.com",
        invitedBy: plainUser, // role "user"
      }),
    (err: Error) => {
      assert.ok(err instanceof invitesDb.InvitationError);
      assert.equal((err as invitesDb.InvitationError).code, "NOT_AUTHORIZED");
      return true;
    }
  );

  const invite = await invitesDb.createInvitation({
    organizationId: orgId,
    email: "y@example.com",
    invitedBy: ownerId,
  });
  await assert.rejects(
    () => invitesDb.revokeInvitation(invite.token, plainUser),
    (err: Error) => {
      assert.ok(err instanceof invitesDb.InvitationError);
      assert.equal((err as invitesDb.InvitationError).code, "NOT_AUTHORIZED");
      return true;
    }
  );
});
