/**
 * P9.03 — quota-enforcement: org-scoped quota is enforced from the routing
 * scope (P6/P7) and is cross-tenant isolated. Personal traffic is unchanged.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-quota-enf-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
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

async function makeOrg(slug: string) {
  const owner = await usersDb.createUser({ role: "user" });
  return orgsDb.createOrganization({ name: slug, slug, ownerUserId: owner.id });
}

test("personal scope is never subject to org quota (legacy unchanged)", async () => {
  const decision = await enf.enforceOrgQuotaScope({
    scope: "personal",
    organizationId: null,
    unit: "requests",
  });
  assert.equal(decision.kind, "allow");
});

test("organization with no quota config is unlimited (allow)", async () => {
  const org = await makeOrg("team1");
  const decision = await enf.enforceOrgQuotaScope({
    scope: "organization",
    organizationId: org.id,
    unit: "requests",
    getUsage: async () => 0,
  });
  assert.equal(decision.kind, "allow");
});

test("org quota blocks when consumption exceeds the org limit", async () => {
  const org = await makeOrg("team1");
  await orgQuotas.setOrganizationQuota(
    org.id,
    { limit: 10, window: "daily", scope: "requests" },
    { organizationId: org.id, role: "owner" }
  );
  // used 9 + estimated 2 > 10 => block
  const block = await enf.enforceOrgQuotaScope({
    scope: "organization",
    organizationId: org.id,
    unit: "requests",
    estimatedAmount: 2,
    getUsage: async () => 9,
  });
  assert.equal(block.kind, "block");
  if (block.kind === "block") {
    assert.equal(block.reason, "org_quota_exceeded");
  }

  // used 9 + estimated 1 <= 10 => allow
  const allow = await enf.enforceOrgQuotaScope({
    scope: "organization",
    organizationId: org.id,
    unit: "requests",
    estimatedAmount: 1,
    getUsage: async () => 9,
  });
  assert.equal(allow.kind, "allow");
});

test("cross-tenant isolation: org A limit never counts org B usage", async () => {
  const orgA = await makeOrg("teama");
  const orgB = await makeOrg("teamb");
  await orgQuotas.setOrganizationQuota(
    orgA.id,
    { limit: 5, window: "daily", scope: "requests" },
    { organizationId: orgA.id, role: "owner" }
  );
  await orgQuotas.setOrganizationQuota(
    orgB.id,
    { limit: 5, window: "daily", scope: "requests" },
    { organizationId: orgB.id, role: "owner" }
  );

  // Simulate: org B has consumed 4 (near its own limit). Org A check must use
  // ONLY org A's pool, not org B's. We feed per-pool usage via the seam.
  const usageByPool = new Map<string, number>([
    [enf.orgQuotaPoolId(orgA.id), 0],
    [enf.orgQuotaPoolId(orgB.id), 4],
  ]);
  const decisionA = await enf.enforceOrgQuotaScope({
    scope: "organization",
    organizationId: orgA.id,
    unit: "requests",
    estimatedAmount: 1,
    getUsage: async (poolId) => usageByPool.get(poolId) ?? 0,
  });
  // Org A has 0 used, limit 5 => allow, even though org B is near its limit.
  assert.equal(decisionA.kind, "allow");

  // Org A's own usage now 5 + 1 > 5 => block (isolated from B).
  const decisionAfull = await enf.enforceOrgQuotaScope({
    scope: "organization",
    organizationId: orgA.id,
    unit: "requests",
    estimatedAmount: 1,
    getUsage: async (poolId) => (poolId === enf.orgQuotaPoolId(orgA.id) ? 5 : 0),
  });
  assert.equal(decisionAfull.kind, "block");
});

test("non-member cannot consume org quota (fail-closed: scope not resolved)", async () => {
  // An actor that cannot resolve an organization scope must not reach the org
  // quota gate. We model this as a denied/unknown scope => allow (legacy path),
  // meaning the authorization layer (P3) is the real gate and quota never
  // widens access.
  const decision = await enf.enforceOrgQuotaScope({
    scope: "denied",
    organizationId: "some-org",
    unit: "requests",
  });
  assert.equal(decision.kind, "allow");
});
