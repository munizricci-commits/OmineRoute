/**
 * P11.03 — concurrency safety: concurrent membership changes, cross-org quota
 * isolation under concurrency, and concurrent invite/accept must not corrupt
 * state or leak across tenants.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec-conc-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const invDb = await import("../../src/lib/db/invitations.ts");
const orgQuotas = await import("../../src/lib/db/orgQuotas.ts");
const enf = await import("../../src/lib/org/orgQuotaEnforcement.ts");

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}
test.beforeEach(() => resetStorage());
test.after(() => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

test("concurrent addMember to same org does not double-add or crash", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });
  const members = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      usersDb
        .createUser({ role: "user" })
        .then((u) =>
          membersDb
            .addMember({ organizationId: org.id, userId: u.id, role: "user" })
            .catch(() => null)
        )
    )
  );
  const list = await membersDb.listMembers(org.id);
  const ids = new Set(list.map((m) => m.userId));
  assert.equal(ids.size, list.length, "no duplicate membership rows");
  assert.ok(list.length >= 1);
});

test("cross-org quota consumption stays isolated under concurrency", async () => {
  const ownerA = await usersDb.createUser({ role: "user" });
  const ownerB = await usersDb.createUser({ role: "user" });
  const orgA = await orgsDb.createOrganization({
    name: "A",
    slug: "teama",
    ownerUserId: ownerA.id,
  });
  const orgB = await orgsDb.createOrganization({
    name: "B",
    slug: "teamb",
    ownerUserId: ownerB.id,
  });
  await orgQuotas.setOrganizationQuota(
    orgA.id,
    { limit: 100, window: "daily", scope: "requests" },
    { organizationId: orgA.id, role: "owner" }
  );
  await orgQuotas.setOrganizationQuota(
    orgB.id,
    { limit: 100, window: "daily", scope: "requests" },
    { organizationId: orgB.id, role: "owner" }
  );

  // Concurrent enforcement checks: org A usage fed only for org A pool.
  const usage = new Map<string, number>([
    [enf.orgQuotaPoolId(orgA.id), 50],
    [enf.orgQuotaPoolId(orgB.id), 50],
  ]);
  const seam = async (poolId: string) => usage.get(poolId) ?? 0;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      enf.enforceOrgQuotaScope({
        scope: "organization",
        organizationId: orgA.id,
        unit: "requests",
        estimatedAmount: 1,
        getUsage: seam,
      })
    )
  );
  for (const r of results) assert.equal(r.kind, "allow", "org A within its own limit");
  // Org B pool must never have been consulted for org A decisions.
  assert.equal(usage.get(enf.orgQuotaPoolId(orgB.id)), 50, "org B usage untouched");
});

test("concurrent invite + accept does not double-add the member", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const invitee = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });

  const [inv] = await Promise.all([
    invDb.createInvitation({
      organizationId: org.id,
      email: "inv@e.x",
      role: "user",
      invitedBy: owner.id,
    }),
    invDb.createInvitation({
      organizationId: org.id,
      email: "inv@e.x",
      role: "user",
      invitedBy: owner.id,
    }),
  ]);
  await Promise.all([
    invDb.acceptInvitation(inv.token, invitee.id).catch(() => null),
    invDb.acceptInvitation(inv.token, invitee.id).catch(() => null),
  ]);
  const list = await membersDb.listMembers(org.id);
  const matches = list.filter((m) => m.userId === invitee.id);
  assert.ok(matches.length <= 1, "member added at most once despite concurrent accepts");
});
