/**
 * P7 — LIVE WIRING of the org-scoped AUTO route.
 *
 * The P7 scope primitives (`resolveAutoRoutingScope`, `buildScopedAutoComboId`,
 * `scopedConnectionIdSet`) were unit-tested but never invoked from the live chat
 * path, so `team1/auto:coding` was dead code in production:
 *   - the raw org-qualified model was never rewritten to its bare route, so
 *     `resolveAutoRoutingState` reported `isAutoRouting: false`;
 *   - `createVirtualAutoCombo` was called without a scope, so the virtual combo
 *     id was never namespaced and the candidate pool was never restricted.
 *
 * These tests pin the wiring seam (`resolveAndApplyOrgAutoScope` +
 * `normalizeAutoRouteForEngine`) and statically pin the three live call sites so
 * the wiring cannot silently regress to dead code again.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeAutoRouteForEngine,
  resolveAndApplyOrgAutoScope,
} from "../../src/lib/org/autoWiring.ts";
import { buildScopedAutoComboId, scopedConnectionIdSet } from "../../src/lib/org/autoScope.ts";

const ROUTE_TS = "src/app/api/v1/chat/completions/route.ts";
const CHAT_TS = "src/sse/handlers/chat.ts";
const ADMISSION_TS = "src/sse/handlers/chatAdmission.ts";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** Org-scoped resolver stub — no DB. */
function orgResolver(connectionIds: string[] = ["conn-1", "conn-2"]) {
  return async () => ({
    route: "auto:coding",
    organizationId: "org-A",
    organizationSlug: "team1",
    connectionIds,
    denied: false,
    ctx: null,
  });
}

test("normalizeAutoRouteForEngine maps the `auto:` form onto the engine's `auto/` form", () => {
  assert.equal(normalizeAutoRouteForEngine("auto:coding"), "auto/coding");
  assert.equal(normalizeAutoRouteForEngine("auto:coding:cheap"), "auto/coding:cheap");
  // Already-engine forms and non-auto routes are identity.
  assert.equal(normalizeAutoRouteForEngine("auto/best-coding"), "auto/best-coding");
  assert.equal(normalizeAutoRouteForEngine("auto"), "auto");
  assert.equal(normalizeAutoRouteForEngine("my-combo"), "my-combo");
  assert.equal(normalizeAutoRouteForEngine("autopilot:x"), "autopilot:x");
});

test("org auto route rewrites the body model to the bare engine route and returns an org scope", async () => {
  const { body, scope } = await resolveAndApplyOrgAutoScope(
    { model: "team1/auto:coding", messages: [] },
    null,
    { resolveOrgRoutingContext: orgResolver() }
  );

  assert.equal(scope.scope, "organization");
  assert.equal(body.model, "auto/coding", "the org qualifier is stripped for the auto engine");
  // (b) the virtual combo id is namespaced per organization
  assert.equal(buildScopedAutoComboId(body.model, scope), "org:org-A:auto/coding");
  // (c) candidate discovery is restricted to the org's connections
  const allowed = scopedConnectionIdSet(scope);
  assert.deepEqual([...(allowed ?? [])].sort(), ["conn-1", "conn-2"]);
});

test("personal auto routes are untouched (no rewrite, unrestricted pool, un-namespaced id)", async () => {
  for (const model of ["auto", "auto/best-coding", "openai/gpt-4o"]) {
    const { body, scope } = await resolveAndApplyOrgAutoScope({ model }, null, {
      resolveOrgRoutingContext: async () => ({
        route: model,
        organizationId: null,
        denied: false,
        ctx: null,
        connectionIds: [],
      }),
    });
    assert.equal(scope.scope, "personal", model);
    assert.equal(body.model, model, `${model} must not be rewritten`);
    assert.equal(scopedConnectionIdSet(scope), null, "personal pool stays unrestricted");
    assert.equal(buildScopedAutoComboId(model, scope), model, "personal id stays un-namespaced");
  }
});

test("denied scope is fail-closed: empty candidate set, never a personal fallback", async () => {
  const { body, scope } = await resolveAndApplyOrgAutoScope({ model: "team1/auto:coding" }, null, {
    resolveOrgRoutingContext: async () => ({
      route: "auto:coding",
      organizationId: null,
      denied: true,
      ctx: null,
      connectionIds: [],
    }),
  });
  assert.equal(scope.scope, "denied");
  assert.equal(body.model, "team1/auto:coding", "a denied request is not rewritten");
  assert.equal(scopedConnectionIdSet(scope)?.size, 0, "denied allows NO candidates");
});

test("resolveAndApplyOrgAutoScope does not mutate the caller's body object", async () => {
  const original = { model: "team1/auto:coding", messages: [] };
  const { body } = await resolveAndApplyOrgAutoScope(original, null, {
    resolveOrgRoutingContext: orgResolver(),
  });
  assert.equal(original.model, "team1/auto:coding");
  assert.notEqual(body, original);
});

test("LIVE: the chat route resolves the org auto scope and threads it into handleChat", () => {
  const src = read(ROUTE_TS);
  assert.match(src, /resolveAndApplyOrgAutoScope/, "route.ts must call the wiring helper");
  assert.match(
    src,
    /handleChat\(request, null, parsedBody, reqId, routingScope\)/,
    "streaming handleChat call must pass the routing scope"
  );
  assert.match(
    src,
    /handleChat\(request, null, parsedBody, undefined, routingScope\)/,
    "non-streaming handleChat call must pass the routing scope"
  );
});

test("LIVE: handleChat accepts a RoutingScope and passes it to createVirtualAutoCombo", () => {
  const chat = read(CHAT_TS);
  assert.match(chat, /routingScope/, "handleChatImplementation must accept a routing scope");
  assert.match(
    chat,
    /createVirtualAutoCombo\(autoRouting, combo, apiKeyInfo\?\.id, routingScope\)/,
    "the virtual auto-combo must be created WITH the routing scope"
  );
  assert.match(
    read(ADMISSION_TS),
    /routingScope/,
    "the admission wrapper must forward the routing scope"
  );
});
