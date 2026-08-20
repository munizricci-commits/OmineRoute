/**
 * 07-invitations / Task 01+02 — invitation state model, creation, expiry, revocation, acceptance.
 *
 * TDD: fails before lib/db/invitations.ts exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-inv-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const {
  createInvitation,
  getInvitationByToken,
  revokeInvitation,
  acceptInvitation,
  consumeInvitation,
  INVITATION_TTL_MS,
} = await import("../../src/lib/db/invitations.ts");

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

test("createInvitation stores a pending, expiring, unused invitation", async () => {
  const inv = await createInvitation({
    organizationId: "org-1",
    email: "invitee@x.io",
    role: "user",
    invitedBy: "owner-1",
  });
  assert.equal(typeof inv.token, "string");
  assert.ok(inv.token.length >= 16);
  const meta = await getInvitationByToken(inv.token);
  assert.ok(meta);
  assert.equal(meta!.status, "pending");
  assert.equal(meta!.email, "invitee@x.io");
  assert.equal(meta!.organizationId, "org-1");
  assert.ok(meta!.expiresAt > Date.now());
});

test("revokeInvitation marks the invitation revoked (not consumable)", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  const ok = await revokeInvitation(inv.token);
  assert.equal(ok, true);
  const meta = await getInvitationByToken(inv.token);
  assert.equal(meta!.status, "revoked");
  const consumed = await consumeInvitation(inv.token);
  assert.equal(consumed, null);
});

test("acceptInvitation transitions to accepted and is single-use", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  const meta = await acceptInvitation(inv.token, "user-1");
  assert.equal(meta!.status, "accepted");
  // Second accept must fail (already consumed).
  const again = await acceptInvitation(inv.token, "user-2");
  assert.equal(again, null);
});

test("expired invitations cannot be consumed", async () => {
  const inv = await createInvitation({ organizationId: "org-1", email: "a@x.io", role: "user" });
  const db = core.getDbInstance();
  const tok = db
    .prepare(`SELECT token FROM organization_invitations WHERE id = ?`)
    .get(inv.id).token;
  db.prepare(`UPDATE organization_invitations SET expires_at = ? WHERE token = ?`).run(
    new Date(Date.now() - 1000).toISOString(),
    tok
  );
  const consumed = await consumeInvitation(tok);
  assert.equal(consumed, null);
});

test("TTL is a reasonable positive duration", () => {
  assert.ok(INVITATION_TTL_MS > 0);
  assert.ok(INVITATION_TTL_MS <= 1000 * 60 * 60 * 24 * 14); // <= 14 days
});
