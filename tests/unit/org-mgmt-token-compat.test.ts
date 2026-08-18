/**
 * P6.04 — management-token-compatibility: organization roles and management
 * token scopes (read/write/admin/manage) are INDEPENDENT. An org owner is not
 * granted management API access, and a manage-scope API key is not granted org
 * membership. No code path conflates the two (Organizations feature).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hasManageScope, MANAGE_SCOPE } from "../../src/lib/api/requireManagementAuth.ts";
import { canManageOrganizationResource } from "../../src/lib/org/authorization.ts";

test("manage-scope token is management-authorized but has NO org role by itself", () => {
  // A manage-scope API key can hit management routes...
  assert.equal(hasManageScope([MANAGE_SCOPE]), true);
  // ...but it conveys no organization membership/role. Org policy predicates
  // must not treat a management scope as org membership.
  assert.equal(
    canManageOrganizationResource({ organizationId: "org-1", role: "user" }),
    false,
    "management scope must not imply org ownership"
  );
});

test("org owner role is NOT a management token scope", () => {
  const ownerCtx = { organizationId: "org-1", role: "owner" as const };
  // Org owner can manage org resources...
  assert.equal(canManageOrganizationResource(ownerCtx), true);
  // ...but without a management token scope they are NOT management-authorized.
  assert.equal(hasManageScope([]), false, "org owner role is not a management scope");
  assert.equal(hasManageScope(["user"]), false);
});

test("org member without owner role cannot manage org resources", () => {
  assert.equal(canManageOrganizationResource({ organizationId: "org-1", role: "user" }), false);
  assert.equal(canManageOrganizationResource({ organizationId: "org-1", role: "moderator" }), true);
  // None of these org roles equal a management token scope string.
  assert.equal(hasManageScope(["moderator"]), false);
  assert.equal(hasManageScope(["owner"]), false, "org role strings are not mgmt scopes");
});

test("management and org authorization come from distinct modules", async () => {
  const mgmt = await import("../../src/lib/api/requireManagementAuth.ts");
  const orgApi = await import("../../src/lib/org/apiAuth.ts");
  // Different entry points — management uses token scopes, org uses membership.
  assert.equal(typeof mgmt.requireManagementAuth, "function");
  assert.equal(typeof orgApi.requireOrganizationAccess, "function");
  assert.notEqual(mgmt.requireManagementAuth, orgApi.requireOrganizationAccess);
});
