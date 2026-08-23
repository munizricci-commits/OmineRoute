/**
 * P7.01 — routing-scope-context: resolve a personal vs organization routing
 * scope for auto routes (Organizations feature, PHASE 7).
 *
 * TDD: the scope object is the context P7.02/P7.04 consume to restrict the auto
 * candidate pool. Tests inject the org-context resolver so the scope logic stays
 * pure and DB-free; the production default wraps P6 `buildOrgRoutingContext`.
 * Because the resolver is injected, the principal argument is irrelevant here
 * and is passed as `null`.
 *
 * Fail-closed: a non-member org auto route must NOT fall back to the personal
 * pool (that would widen credential scope) — it yields a `denied` scope with no
 * candidates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  isAutoRoute,
  resolveAutoRoutingScope,
  scopeAllowsConnection,
  scopedConnectionIdSet,
  type OrganizationRoutingScope,
  type RoutingScope,
} from "../../src/lib/org/autoScope.ts";
import type { OrgRoutingContext } from "../../src/lib/org/qualifiedRoute.ts";

/** Build a fake P6-shaped org routing context resolver. */
function resolver(ctxLike: OrgRoutingContext) {
  return async (): Promise<OrgRoutingContext> => ctxLike;
}

test("isAutoRoute detects auto routes in both `auto:` and `auto/` forms", () => {
  assert.equal(isAutoRoute("auto"), true);
  assert.equal(isAutoRoute("auto:coding"), true);
  assert.equal(isAutoRoute("auto/best-coding"), true);
  assert.equal(isAutoRoute("gpt-4"), false);
  assert.equal(isAutoRoute("combo:dev"), false);
  assert.equal(isAutoRoute("autopilot"), false, "must not prefix-match unrelated names");
  assert.equal(isAutoRoute(undefined as unknown as string), false);
});

test("personal auto route resolves to personal scope", async () => {
  const scope = await resolveAutoRoutingScope({ model: "auto:coding" }, null, {
    resolveOrgRoutingContext: resolver({
      route: "auto:coding",
      organizationId: null,
      denied: false,
      connectionIds: [],
      ctx: null,
    }),
  });
  assert.equal(scope.scope, "personal");
  assert.equal(scope.route, "auto:coding");
});

test("org auto route resolves to organization scope carrying connectionIds", async () => {
  const scope = await resolveAutoRoutingScope({ model: "team1/auto:coding" }, null, {
    resolveOrgRoutingContext: resolver({
      route: "auto:coding",
      organizationId: "org-a",
      organizationSlug: "team1",
      denied: false,
      connectionIds: ["c1", "c2"],
      ctx: null,
    }),
  });
  assert.equal(scope.scope, "organization");
  assert.equal(scope.route, "auto:coding", "bare route is stripped of the org qualifier");
  if (scope.scope !== "organization") return;
  assert.equal(scope.organizationId, "org-a");
  assert.deepEqual(scope.connectionIds, ["c1", "c2"]);
});

test("non-member org auto route is DENIED, never personal-fallback (fail-closed)", async () => {
  const scope = await resolveAutoRoutingScope({ model: "team1/auto:coding" }, null, {
    resolveOrgRoutingContext: resolver({
      route: "auto:coding",
      organizationId: null,
      denied: true,
      connectionIds: [],
      ctx: null,
    }),
  });
  assert.equal(scope.scope, "denied", "must not widen to the personal pool");
  assert.equal(scopedConnectionIdSet(scope)?.size, 0);
});

test("resolver failure fails closed for an org-qualified auto route", async () => {
  const scope = await resolveAutoRoutingScope({ model: "team1/auto:coding" }, null, {
    resolveOrgRoutingContext: async () => {
      throw new Error("db down");
    },
  });
  assert.equal(scope.scope, "denied");
});

test("resolver failure on a bare personal model stays personal", async () => {
  const scope = await resolveAutoRoutingScope({ model: "auto:coding" }, null, {
    resolveOrgRoutingContext: async () => {
      throw new Error("db down");
    },
  });
  assert.equal(scope.scope, "personal");
});

test("scopedConnectionIdSet is null for personal (unrestricted pool)", () => {
  const personal: RoutingScope = { scope: "personal", route: "auto" };
  assert.equal(scopedConnectionIdSet(personal), null);
});

test("scopeAllowsConnection enforces the org allowlist", () => {
  const orgScope: OrganizationRoutingScope = {
    scope: "organization",
    route: "auto:coding",
    organizationId: "org-a",
    connectionIds: ["c1", "c2"],
    ctx: null,
  };
  const personal: RoutingScope = { scope: "personal", route: "auto" };
  const denied: RoutingScope = { scope: "denied", route: "auto" };

  assert.equal(scopeAllowsConnection(orgScope, "c1"), true);
  assert.equal(scopeAllowsConnection(orgScope, "c9"), false, "org B connection must be rejected");
  assert.equal(scopeAllowsConnection(orgScope, null), false, "unknown connection fails closed");
  assert.equal(scopeAllowsConnection(personal, "c9"), true, "personal scope is unrestricted");
  assert.equal(scopeAllowsConnection(denied, "c1"), false, "denied scope allows nothing");
});

test("org auto scope with zero org connections stays organization-scoped and empty", async () => {
  const scope = await resolveAutoRoutingScope({ model: "team1/auto" }, null, {
    resolveOrgRoutingContext: resolver({
      route: "auto",
      organizationId: "org-a",
      denied: false,
      connectionIds: [],
      ctx: null,
    }),
  });
  assert.equal(scope.scope, "organization");
  assert.equal(scopedConnectionIdSet(scope)?.size, 0, "empty org pool must not widen to personal");
});
