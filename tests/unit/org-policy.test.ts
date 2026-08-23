/**
 * P3.02 (central-policy) — TDD.
 *
 * Exercises the centralized org authorization predicates: happy paths per role,
 * the platform_admin override (via `platformAdminOrganizationContext`), and
 * fail-closed denial for non-members / ordinary members on owner-only actions.
 */

import test from "node:test";
import assert from "node:assert/strict";

const authz = await import("../../src/lib/org/authorization.ts");

type Ctx = {
  organizationId: string;
  role: "owner" | "moderator" | "user";
  platformAdminOverride?: boolean;
};

const owner: Ctx = { organizationId: "o1", role: "owner" };
const moderator: Ctx = { organizationId: "o1", role: "moderator" };
const member: Ctx = { organizationId: "o1", role: "user" };
const adminOverride = authz.platformAdminOrganizationContext("o1");

test("every predicate is fail-closed for a null context", () => {
  assert.equal(authz.canReadOrganization(null), false);
  assert.equal(authz.canUseOrganizationResource(null), false);
  assert.equal(authz.canManageOrganizationResource(null), false);
  assert.equal(authz.canManageMembership(null), false);
  assert.equal(authz.canArchiveOrganization(null), false);
  assert.equal(authz.canDeleteOrganization(null), false);
});

test("owner has full privileges", () => {
  assert.equal(authz.canReadOrganization(owner), true);
  assert.equal(authz.canUseOrganizationResource(owner), true);
  assert.equal(authz.canManageOrganizationResource(owner), true);
  assert.equal(authz.canManageMembership(owner), true);
  assert.equal(authz.canArchiveOrganization(owner), true);
  assert.equal(authz.canDeleteOrganization(owner), true);
});

test("moderator can manage routing resources but not membership/archive/delete", () => {
  assert.equal(authz.canReadOrganization(moderator), true);
  assert.equal(authz.canUseOrganizationResource(moderator), true);
  assert.equal(authz.canManageOrganizationResource(moderator), true);
  assert.equal(authz.canManageMembership(moderator), false, "moderator cannot manage membership");
  assert.equal(authz.canArchiveOrganization(moderator), false, "moderator cannot archive");
  assert.equal(authz.canDeleteOrganization(moderator), false, "moderator cannot delete");
});

test("ordinary user can read/use but not mutate", () => {
  assert.equal(authz.canReadOrganization(member), true);
  assert.equal(authz.canUseOrganizationResource(member), true);
  assert.equal(authz.canManageOrganizationResource(member), false);
  assert.equal(authz.canManageMembership(member), false);
  assert.equal(authz.canArchiveOrganization(member), false);
  assert.equal(authz.canDeleteOrganization(member), false);
});

test("platform_admin override grants full org privileges through the same predicates", () => {
  assert.equal(authz.canReadOrganization(adminOverride), true);
  assert.equal(authz.canManageOrganizationResource(adminOverride), true);
  assert.equal(authz.canManageMembership(adminOverride), true);
  assert.equal(authz.canArchiveOrganization(adminOverride), true);
  assert.equal(authz.canDeleteOrganization(adminOverride), true);
  assert.equal(adminOverride.platformAdminOverride, true);
  assert.equal(adminOverride.role, "owner");
});

test("platform_admin override is distinguished from a real owner by the flag", () => {
  assert.equal(owner.platformAdminOverride, undefined);
  assert.equal(adminOverride.platformAdminOverride, true);
});

test("non-member (null) is denied everything — fail-closed", () => {
  const ctx: Ctx | null = null;
  assert.equal(authz.canManageMembership(ctx), false);
  assert.equal(authz.canArchiveOrganization(ctx), false);
  assert.equal(authz.canDeleteOrganization(ctx), false);
  assert.equal(authz.canManageOrganizationResource(ctx), false);
});
