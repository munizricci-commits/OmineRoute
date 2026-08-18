/**
 * P11.05 — CI static-checks anchor: the org feature's public entrypoints are
 * importable from `@/lib/localDb` (re-export sanity) so the build/typecheck
 * pipeline has a trackable org surface. This also confirms the modules compile
 * under `tsx` (import resolution succeeded).
 */

import test from "node:test";
import assert from "node:assert/strict";

const localDb = await import("../../src/lib/localDb.ts");

test("org feature entrypoints are re-exported from @/lib/localDb", () => {
  // Identity / principal (P1)
  assert.equal(typeof localDb.createUser, "function");
  assert.equal(typeof localDb.resolveDashboardUserPrincipal, "function");
  // Organizations (P2)
  assert.equal(typeof localDb.createOrganization, "function");
  assert.equal(typeof localDb.listUserOrganizations, "function");
  assert.equal(typeof localDb.addMember, "function");
  assert.equal(typeof localDb.createInvitation, "function");
  // Authorization (P3)
  assert.equal(typeof localDb.resolveOrganizationContext, "function");
  assert.equal(typeof localDb.requireOrganizationAccess, "function");
  assert.equal(typeof localDb.resolveOrgAccess, "function");
  assert.equal(typeof localDb.canManageOrganizationResource, "function");
  // Connections (P4)
  assert.equal(typeof localDb.getOrganizationConnections, "function");
  assert.equal(typeof localDb.createOrganizationConnection, "function");
  // Combos (P5)
  assert.equal(typeof localDb.createOrganizationCombo, "function");
  assert.equal(typeof localDb.getOrganizationCombos, "function");
  // Qualified routes (P6)
  assert.equal(typeof localDb.parseQualifiedModel, "function");
  assert.equal(typeof localDb.buildOrgRoutingContext, "function");
  assert.equal(typeof localDb.resolveQualifiedRoute, "function");
  // Auto scope (P7)
  assert.equal(typeof localDb.resolveAutoRoutingScope, "function");
  assert.equal(typeof localDb.scopedConnectionIdSet, "function");
  // Quota (P9)
  assert.equal(typeof localDb.getOrganizationQuota, "function");
  assert.equal(typeof localDb.setOrganizationQuota, "function");
  // Types are present at the type level; this runtime check confirms the values.
  assert.ok(true);
});

test("org modules compile and import cleanly", async () => {
  // Importing the handler/service module pulls in all org prod code; success
  // means it parsed + resolved under the project's TS/alias config.
  const api = await import("../../src/lib/org/orgApiService.ts");
  assert.equal(typeof api.getOrganizationQuotaHandler, "function");
  assert.equal(typeof api.setOrganizationQuotaHandler, "function");
  const enf = await import("../../src/lib/org/orgQuotaEnforcement.ts");
  assert.equal(typeof enf.enforceOrgQuotaScope, "function");
});
