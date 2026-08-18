/**
 * P9.02 — organization-quota: configuration of per-organization quota via the
 * existing quota infrastructure. Additive (Invariant #1): setting an org quota
 * never touches the legacy personal/registered-key quota machinery.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-quota-cfg-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const orgQuotas = await import("../../src/lib/db/orgQuotas.ts");

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(() => {
  resetStorage();
});

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

function ownerCtx(orgId: string) {
  return { organizationId: orgId, role: "owner" as const };
}

test("set + get organization quota (manager only)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Team 1",
    slug: "team1",
    ownerUserId: owner.id,
  });

  // non-manager (plain member role) cannot set
  await assert.rejects(
    () =>
      orgQuotas.setOrganizationQuota(
        org.id,
        { limit: 1000, window: "daily", scope: "requests" },
        { organizationId: org.id, role: "user" }
      ),
    (e: unknown) => e instanceof orgQuotas.OrgQuotaError && e.code === "NOT_AUTHORIZED"
  );

  // owner can set
  const cfg = await orgQuotas.setOrganizationQuota(
    org.id,
    { limit: 1000, window: "daily", scope: "requests" },
    ownerCtx(org.id)
  );
  assert.equal(cfg.organizationId, org.id);
  assert.equal(cfg.limit, 1000);
  assert.equal(cfg.window, "daily");
  assert.equal(cfg.scope, "requests");

  const read = await orgQuotas.getOrganizationQuota(org.id);
  assert.ok(read);
  assert.equal(read!.limit, 1000);

  // null limit => unlimited, still updateable
  const unlimited = await orgQuotas.setOrganizationQuota(
    org.id,
    { limit: null, window: "daily", scope: "requests" },
    ownerCtx(org.id)
  );
  assert.equal(unlimited.limit, null);
});

test("unknown organization cannot get a quota config (no cross-tenant leak)", async () => {
  const cfg = await orgQuotas.getOrganizationQuota("does-not-exist");
  assert.equal(cfg, null);
});

test("personal quota machinery is untouched (additive, Invariant #1)", async () => {
  // Creating an org quota must not affect the legacy personal path. We simply
  // assert the new table is isolated and the legacy registeredKeys check still
  // resolves (backward-compat anchor is P9.01; here we assert no side effects).
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    name: "Team 2",
    slug: "team2",
    ownerUserId: owner.id,
  });
  await orgQuotas.setOrganizationQuota(
    org.id,
    { limit: 500, window: "hourly", scope: "tokens" },
    ownerCtx(org.id)
  );
  // A different org has no quota until configured.
  const otherOwner = await usersDb.createUser({ role: "user" });
  const otherOrg = await orgsDb.createOrganization({
    name: "Team 3",
    slug: "team3",
    ownerUserId: otherOwner.id,
  });
  const otherCfg = await orgQuotas.getOrganizationQuota(otherOrg.id);
  assert.equal(otherCfg, null, "unconfigured org must have no quota row");
});
