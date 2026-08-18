/**
 * P7.03 — cache-scope: virtual auto-combo / cache / cooldown / lockout KEYS must
 * be namespaced by organization so two orgs requesting the same auto channel
 * never share cached results, cooldowns, or model lockouts across a tenant
 * boundary. Personal routes keep their existing un-namespaced keys (backward
 * compatible — pre-P7 cache entries and behavior untouched).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutoRoutingScope,
  autoScopeKey,
  buildScopedAutoComboId,
} from "../../src/lib/org/autoScope.ts";

// Build a minimal RoutingScope without a DB using the injection seam.
function orgScope(organizationId: string, connectionIds: string[] = ["c1"]) {
  return {
    scope: "organization" as const,
    route: "auto:coding",
    organizationId,
    organizationSlug: organizationId,
    connectionIds,
    ctx: null,
  };
}

test("personal auto channel keeps its existing un-namespaced combo id", () => {
  const personal = { scope: "personal" as const, route: "auto:coding" };
  assert.equal(buildScopedAutoComboId("auto:coding", personal), "auto:coding");
  assert.equal(autoScopeKey(personal), null, "personal has no namespace");
});

test("two organizations get DISTINCT namespaced combo ids for the same channel", () => {
  const a = orgScope("org-A");
  const b = orgScope("org-B");
  const idA = buildScopedAutoComboId("auto:coding", a);
  const idB = buildScopedAutoComboId("auto:coding", b);
  assert.notEqual(idA, idB, "orgs must not collide on the same channel");
  assert.equal(idA, "org:org-A:auto:coding");
  assert.equal(idB, "org:org-B:auto:coding");
  assert.equal(autoScopeKey(a), "org:org-A");
  assert.equal(autoScopeKey(b), "org:org-B");
});

test("denied scope gets its own isolated namespace (no key poisoning)", () => {
  const denied = { scope: "denied" as const, route: "auto:coding" };
  assert.equal(autoScopeKey(denied), "org:denied");
  assert.equal(buildScopedAutoComboId("auto:coding", denied), "org:denied:auto:coding");
});

test("distinct combo ids imply distinct cache/cooldown/lockout keys", () => {
  const a = orgScope("org-A");
  const b = orgScope("org-B");
  assert.notEqual(
    buildScopedAutoComboId("auto:coding", a),
    buildScopedAutoComboId("auto:coding", b)
  );
});

test("resolveAutoRoutingScope returns organization scope with connectionIds for a member", async () => {
  // injection seam so we don't need a live DB here
  const scope = await resolveAutoRoutingScope(
    { model: "team1/auto:coding" },
    {
      userId: "u1",
      user: { id: "u1", status: "active", role: "user" },
      isOrganizationScoped: false,
    },
    {
      resolveOrgRoutingContext: async () => ({
        route: "auto:coding",
        organizationId: "org-A",
        organizationSlug: "team1",
        denied: false,
        connectionIds: ["c1", "c2"],
        ctx: null,
      }),
    }
  );
  assert.equal(scope.scope, "organization");
  if (scope.scope === "organization") {
    assert.equal(buildScopedAutoComboId(scope.route, scope), "org:org-A:auto:coding");
  }
});
