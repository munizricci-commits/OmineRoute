/**
 * 07-invitations / Task 06 — token secrecy, replay, expiry, wrong-user, cross-org isolation.
 *
 * TDD: consolidates invitation security properties with focused tests. Most are
 * unit/integration proofs against db/invitations + accept-invitation route.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-invsec-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync, getUserByEmail } = await import("../../src/lib/db/users.ts");
const { createOrganization } = await import("../../src/lib/db/organizations.ts");
const { createInvitation, getInvitationByToken, acceptInvitation, revokeInvitation } =
  await import("../../src/lib/db/invitations.ts");
const { getMembership } = await import("../../src/lib/db/members.ts");
const routeMod = await import("../../src/app/api/accept-invitation/route.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function req(body: unknown): Request {
  return new Request("http://localhost/api/accept-invitation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("token is a high-entropy secret, never the raw record id", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  assert.notEqual(inv.token, inv.id);
  assert.ok(inv.token.length >= 32);
  // Stored token must not be a guessable value (no plaintext email / id).
  assert.ok(!inv.token.includes("@"));
});

test("replay: a consumed token cannot be accepted twice", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const inv = await createInvitation({ organizationId: org.id, email: "a@x.io", role: "user" });
  const first = await routeMod.POST(req({ token: inv.token }));
  assert.equal(first.status, 200);
  const second = await routeMod.POST(req({ token: inv.token }));
  assert.equal(second.status, 409);
});

test("expiry: an expired token is rejected", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  const db = core.getDbInstance();
  const tok = db
    .prepare(`SELECT token FROM organization_invitations WHERE id = ?`)
    .get(inv.id).token;
  db.prepare(`UPDATE organization_invitations SET expires_at = ? WHERE token = ?`).run(
    new Date(Date.now() - 1000).toISOString(),
    tok
  );
  const res = await routeMod.POST(req({ token: tok }));
  assert.equal(res.status, 409);
});

test("cross-org isolation: a token cannot join a different org", async () => {
  const ownerA = createUserSync({ role: "user", email: "ownerA@x.io" });
  const ownerB = createUserSync({ role: "user", email: "ownerB@x.io" });
  const orgA = await createOrganization({ slug: "org-a", name: "A", ownerUserId: ownerA.id });
  const orgB = await createOrganization({ slug: "org-b", name: "B", ownerUserId: ownerB.id });
  const inv = await createInvitation({ organizationId: orgA.id, email: "a@x.io", role: "user" });

  // Accept the token (joins orgA).
  const res = await routeMod.POST(req({ token: inv.token }));
  assert.equal(res.status, 200);
  const u = await getUserByEmail("a@x.io");
  assert.ok(u);
  // Must be a member of orgA, NOT orgB.
  assert.ok(await getMembership(orgA.id, u!.id));
  assert.equal(await getMembership(orgB.id, u!.id), null);
});

test("wrong-user: accepting an invitation never binds a different email", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  // Invitation is for invitee@x.io; a pre-existing other@x.io user must NOT be
  // joined by accepting this token.
  const other = createUserSync({ role: "user", email: "other@x.io" });
  const inv = await createInvitation({
    organizationId: org.id,
    email: "invitee@x.io",
    role: "user",
  });
  const res = await routeMod.POST(req({ token: inv.token }));
  assert.equal(res.status, 200);
  // other@x.io must remain outside the org.
  assert.equal(await getMembership(org.id, other.id), null);
  // invitee@x.io (auto-created) is the one joined.
  const invitee = await getUserByEmail("invitee@x.io");
  assert.ok(invitee);
  assert.ok(await getMembership(org.id, invitee!.id));
});

test("revocation: a revoked token is not consumable", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  assert.equal(await revokeInvitation(inv.token), true);
  const accepted = await acceptInvitation(inv.token, "some-user");
  assert.equal(accepted, null);
});
