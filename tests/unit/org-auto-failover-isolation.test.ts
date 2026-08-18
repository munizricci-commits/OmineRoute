/**
 * P7.04 — failover-isolation: the EXISTING intra-request auto failover (cross-
 * candidate) must stay INSIDE the org candidate pool when org-scoped. A failed
 * org-A candidate must fail over only to another org-A candidate — never to a
 * personal or org-B connection. Reuses the existing failover path's pool; this
 * test proves the pool fed to it is correctly scoped (the failover engine
 * selects from whatever pool it receives, so scoping the pool scopes failover).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { filterCandidatesByAllowedConnections } from "../../open-sse/services/autoCombo/candidateOverrides.ts";
import { scopedConnectionIdSet, scopeAllowsConnection } from "../../src/lib/org/autoScope.ts";

type Candidate = { connectionId: string | null; allowedConnectionIds?: string[] };

const pool: Candidate[] = [
  { connectionId: "orgA-1", allowedConnectionIds: ["orgA-1"] },
  { connectionId: "orgA-2", allowedConnectionIds: ["orgA-2"] },
  { connectionId: "orgB-1", allowedConnectionIds: ["orgB-1"] },
  { connectionId: "personal-1", allowedConnectionIds: ["personal-1"] },
  { connectionId: null }, // no-auth synthetic — must be dropped under org scope
];

const orgAScope = {
  scope: "organization" as const,
  route: "auto:coding",
  organizationId: "org-A",
  connectionIds: ["orgA-1", "orgA-2"],
  ctx: null,
};

test("org-A scope restricts pool to org-A connections only", () => {
  const allowed = scopedConnectionIdSet(orgAScope);
  assert.ok(allowed instanceof Set);
  const scoped = filterCandidatesByAllowedConnections(pool, allowed);
  // org-A candidates kept; org-B, personal, and null dropped
  assert.deepEqual(
    scoped.map((c) => c.connectionId),
    ["orgA-1", "orgA-2"]
  );
});

test("failover within scoped pool cannot reach org-B or personal connections", () => {
  const allowed = scopedConnectionIdSet(orgAScope);
  const scoped = filterCandidatesByAllowedConnections(pool, allowed);
  for (const c of scoped) {
    // every survivor is permitted under the org-A scope
    assert.equal(scopeAllowsConnection(orgAScope, c.connectionId), true);
    // and never an out-of-scope connection
    assert.notEqual(c.connectionId, "orgB-1");
    assert.notEqual(c.connectionId, "personal-1");
  }
});

test("personal scope (null) leaves the full pool intact — legacy failover unchanged", () => {
  const allowed = scopedConnectionIdSet({ scope: "personal", route: "auto:coding" });
  assert.equal(allowed, null, "personal scope is unrestricted");
  const scoped = filterCandidatesByAllowedConnections(pool, allowed);
  assert.equal(scoped.length, pool.length, "personal pool is byte-identical to input");
});

test("denied scope yields an EMPTY allow-set → empty pool (fail-closed, no widening)", () => {
  const denied = { scope: "denied" as const, route: "auto:coding" };
  const allowed = scopedConnectionIdSet(denied);
  assert.equal(allowed?.size, 0);
  const scoped = filterCandidatesByAllowedConnections(pool, allowed);
  assert.equal(scoped.length, 0, "a denied auto request gets NO candidates");
});

test("scopeAllowsConnection is fail-closed for unknown connection ids", () => {
  assert.equal(scopeAllowsConnection(orgAScope, "orgB-1"), false);
  assert.equal(scopeAllowsConnection(orgAScope, "unknown"), false);
  assert.equal(scopeAllowsConnection(orgAScope, "orgA-1"), true);
});
