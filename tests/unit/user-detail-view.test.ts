/**
 * 03-platform-user-admin / Task 04 — user detail view formatting helper.
 *
 * TDD: fails before formatMemberships exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatMemberships } from "../../src/lib/auth/userDetailView.ts";

test("empty memberships -> empty list", () => {
  assert.deepEqual(formatMemberships([]), []);
  assert.deepEqual(formatMemberships(undefined as never), []);
});

test("maps memberships to role@org (status)", () => {
  const out = formatMemberships([
    { organizationId: "org-1", role: "owner", status: "active" },
    { organizationId: "org-2", role: "member", status: "active" },
  ]);
  assert.deepEqual(out, ["owner@org-1 (active)", "member@org-2 (active)"]);
});
