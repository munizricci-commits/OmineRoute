/**
 * 07-invitations / Task 05 — invitation acceptance + account binding (UI flow backend).
 *
 * Integration proof: POST /api/accept-invitation consumes a valid token, binds
 * the invitation email to the org via a membership row, and marks the
 * invitation accepted (single-use). Wrong/unknown/expired -> rejected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-accept-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync, getUserByEmail } = await import("../../src/lib/db/users.ts");
const { createOrganization } = await import("../../src/lib/db/organizations.ts");
const { createInvitation, getInvitationByToken } = await import("../../src/lib/db/invitations.ts");
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

test("valid token binds the invited email to the org and marks accepted", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const inv = await createInvitation({
    organizationId: org.id,
    email: "invitee@x.io",
    role: "user",
  });

  const res = await routeMod.POST(req({ token: inv.token }));
  assert.equal(res.status, 200);

  const u = await getUserByEmail("invitee@x.io");
  assert.ok(u, "user should be created for the invited email");
  const membership = await getMembership(org.id, u!.id);
  assert.ok(membership, "membership should exist");
  assert.equal(membership!.status, "active");

  const meta = await getInvitationByToken(inv.token);
  assert.equal(meta!.status, "accepted");
});

test("reused token is rejected (single-use)", async () => {
  const owner = createUserSync({ role: "user", email: "owner@x.io" });
  const org = await createOrganization({ slug: "acme", name: "Acme", ownerUserId: owner.id });
  const inv = await createInvitation({
    organizationId: org.id,
    email: "invitee@x.io",
    role: "user",
  });

  const first = await routeMod.POST(req({ token: inv.token }));
  assert.equal(first.status, 200);
  const second = await routeMod.POST(req({ token: inv.token }));
  assert.equal(second.status, 409);
});

test("unknown token is rejected", async () => {
  const res = await routeMod.POST(req({ token: "a".repeat(32) }));
  assert.equal(res.status, 404);
});
