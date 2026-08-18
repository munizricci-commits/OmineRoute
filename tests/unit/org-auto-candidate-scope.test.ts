/**
 * P7.02 — auto-candidate-scope: the virtual auto-combo candidate pool must be
 * restricted to the organization's own connections when org-scoped.
 *
 * TDD: exercises BOTH the pure allowlist filter and the real
 * `createVirtualAutoComboFromPrepared` factory (with synthetic prepared inputs,
 * so no DB is needed) — the existing auto engine is reused, only SCOPED.
 *
 * Two-org isolation is the security-critical property: an auto request scoped to
 * org A must NEVER surface org B's connections as candidates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { filterCandidatesByAllowedConnections } from "../../open-sse/services/autoCombo/candidateOverrides.ts";
import {
  createVirtualAutoComboFromPrepared,
  type PreparedVirtualAutoComboInputs,
  type VirtualAutoComboCandidate,
} from "../../open-sse/services/autoCombo/virtualFactory.ts";
import { scopedConnectionIdSet, type RoutingScope } from "../../src/lib/org/autoScope.ts";

function candidate(
  provider: string,
  model: string,
  connectionId: string | null,
  allowedConnectionIds?: string[]
): VirtualAutoComboCandidate {
  return {
    provider,
    connectionId,
    ...(allowedConnectionIds ? { allowedConnectionIds } : {}),
    model,
    modelStr: `${provider}/${model}`,
    costPer1MTokens: 1,
  };
}

/** org A: a1,a2 · org B: b1 · personal: p1 */
function prepared(): PreparedVirtualAutoComboInputs {
  const pool = [
    candidate("openai", "gpt-4o", "a1"),
    candidate("anthropic", "claude-3", "a2"),
    candidate("groq", "llama-3", "b1"),
    candidate("mistral", "mistral-large", "p1"),
  ];
  return { regularCandidates: pool, familyCandidates: pool };
}

/**
 * The connection ids actually reachable through the built combo. NOTE: the
 * returned `candidatePool` is a list of PROVIDER names; the concrete connection
 * identities live on `models[]` (`connectionId` / `allowedConnectionIds`), so
 * that is what a tenant-isolation assertion must inspect.
 */
function connIds(combo: {
  models?: Array<{ connectionId?: string | null; allowedConnectionIds?: string[] }>;
}): string[] {
  const out: string[] = [];
  for (const m of combo.models || []) {
    if (Array.isArray(m.allowedConnectionIds)) out.push(...m.allowedConnectionIds);
    else if (typeof m.connectionId === "string") out.push(m.connectionId);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- pure filter

test("allowlist filter keeps only allowed connection ids", () => {
  const pool = [candidate("openai", "m", "a1"), candidate("groq", "m", "b1")];
  const out = filterCandidatesByAllowedConnections(pool, new Set(["a1"]));
  assert.deepEqual(
    out.map((c) => c.connectionId),
    ["a1"]
  );
});

test("allowlist filter is the identity function when unrestricted (null)", () => {
  const pool = [candidate("openai", "m", "a1")];
  assert.equal(filterCandidatesByAllowedConnections(pool, null), pool, "same reference");
});

test("allowlist filter narrows multi-account allowedConnectionIds to the org subset", () => {
  const pool = [candidate("openai", "gpt-4o", null, ["a1", "b1"])];
  const out = filterCandidatesByAllowedConnections(pool, new Set(["a1"]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].allowedConnectionIds, ["a1"], "org B account must be stripped");
});

test("allowlist filter drops a candidate whose every account is out of scope", () => {
  const pool = [candidate("openai", "gpt-4o", null, ["b1", "b2"])];
  assert.deepEqual(filterCandidatesByAllowedConnections(pool, new Set(["a1"])), []);
});

test("allowlist filter with an EMPTY set allows nothing (fail-closed)", () => {
  const pool = [candidate("openai", "m", "a1"), candidate("openai", "m2", null, ["a2"])];
  assert.deepEqual(filterCandidatesByAllowedConnections(pool, new Set<string>()), []);
});

test("allowlist filter fails closed on a candidate with no connection identity", () => {
  const pool = [candidate("openai", "m", null)];
  assert.deepEqual(filterCandidatesByAllowedConnections(pool, new Set(["a1"])), []);
});

// ------------------------------------------------- real factory, org-scoped

test("org auto returns ONLY the organization's connections", async () => {
  const combo = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: new Set(["a1", "a2"]),
    }
  );
  assert.deepEqual(connIds(combo).sort(), ["a1", "a2"]);
});

test("org A auto NEVER includes org B connections (two-org isolation)", async () => {
  const orgA = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: new Set(["a1", "a2"]),
    }
  );
  const orgB = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: new Set(["b1"]),
    }
  );

  assert.equal(connIds(orgA).includes("b1"), false, "org A leaked an org B connection");
  assert.equal(connIds(orgB).includes("a1"), false, "org B leaked an org A connection");
  assert.equal(connIds(orgB).includes("a2"), false, "org B leaked an org A connection");
  assert.equal(connIds(orgA).includes("p1"), false, "org A leaked a personal connection");
  assert.deepEqual(connIds(orgB), ["b1"]);
});

test("personal auto keeps the full personal pool unchanged", async () => {
  const scoped = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: null,
    }
  );
  const legacy = await createVirtualAutoComboFromPrepared(prepared(), undefined);
  assert.deepEqual(connIds(scoped).sort(), ["a1", "a2", "b1", "p1"]);
  assert.deepEqual(connIds(legacy).sort(), connIds(scoped).sort(), "unscoped call unchanged");
});

test("denied scope yields an EMPTY candidate pool (fail-closed, no personal widening)", async () => {
  const denied: RoutingScope = { scope: "denied", route: "auto" };
  const combo = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: scopedConnectionIdSet(denied),
    }
  );
  assert.deepEqual(connIds(combo), [], "a non-member must get no candidates at all");
});

test("org scope with no connections yields an empty pool, not the personal pool", async () => {
  const combo = await createVirtualAutoComboFromPrepared(
    prepared(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: new Set<string>(),
    }
  );
  assert.deepEqual(connIds(combo), []);
});

test("org scoping composes with the variant weights of the existing engine", async () => {
  const combo = await createVirtualAutoComboFromPrepared(
    prepared(),
    "coding",
    undefined,
    undefined,
    undefined,
    {
      allowedConnectionIds: new Set(["a1"]),
    }
  );
  assert.deepEqual(connIds(combo), ["a1"]);
  assert.equal(combo.strategy, "auto", "reuses the existing auto engine, no second engine");
  assert.ok(combo.weights, "variant weights still applied under org scope");
});
