/**
 * P10.01 — personal-routing-regression: REGRESSION ANCHOR proving that the
 * Organizations feature is strictly ADDITIVE for routing (Invariant #1 / #11).
 *
 * This file adds NO production code. It documents and pins the CURRENT legacy
 * behavior of the personal (non-qualified) routing path so a later change to the
 * org layer cannot silently intercept plain model names:
 *
 *   1. `parseQualifiedModel` never produces an org qualifier for a plain model
 *      name, a provider-prefixed model id, or a malformed qualifier.
 *   2. `buildOrgRoutingContext` for a plain model yields the personal shape
 *      (organizationId null, denied false, no scoped connection ids) — the chat
 *      handler therefore behaves exactly as before the org feature existed.
 *   3. A bare combo name still resolves to the PERSONAL combo, with NO principal
 *      and NO organization context required.
 *   4. Org-scoped combos are NEVER reachable through a bare (unqualified) name,
 *      even for a member — org routing is a strict superset, not a rewrite.
 *   5. The auto-routing scope for a personal route is the unrestricted personal
 *      scope (no connection-id restriction).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-compat-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const orgCombos = await import("../../src/lib/db/orgCombos.ts");
const qr = await import("../../src/lib/org/qualifiedRoute.ts");
const autoScope = await import("../../src/lib/org/autoScope.ts");

const DB_FILES = ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"];

async function resetStorage() {
  core.resetDbInstance();
  for (const f of DB_FILES) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  for (const f of DB_FILES) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

test("plain model names are never parsed as org-qualified", () => {
  for (const model of ["gpt-4", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "auto:cost"]) {
    const parsed = qr.parseQualifiedModel(model);
    assert.equal(parsed.organizationSlug, undefined, `${model} must stay personal`);
    assert.equal(parsed.route, model, `${model} route must be unchanged`);
  }
});

test("provider-prefixed and malformed model ids stay personal", () => {
  for (const model of [
    "openai/gpt-4",
    "anthropic/claude-3-opus",
    "team1/openai/gpt-4", // nested → personal provider id
    "//gpt-4", // empty leading segment
    "gpt-4/", // empty route
  ]) {
    const parsed = qr.parseQualifiedModel(model);
    assert.equal(parsed.organizationSlug, undefined, `${model} must stay personal`);
    assert.equal(parsed.route, model, `${model} route must be unchanged`);
  }
});

test("buildOrgRoutingContext for a plain model yields the legacy personal context", async () => {
  const ctx = await qr.buildOrgRoutingContext({ model: "gpt-4" }, null);
  assert.equal(ctx.route, "gpt-4");
  assert.equal(ctx.organizationId, null, "no org scope for a plain model");
  assert.equal(ctx.denied, false, "personal routing is never denied by org authz");
  assert.deepEqual(ctx.connectionIds, [], "personal routing is not connection-restricted");
  assert.equal(ctx.ctx, null);
});

test("existing organizations do not intercept a plain model name", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  await orgsDb.createOrganization({ slug: "team1", name: "Team 1", ownerUserId: owner.id });

  // Even with org `team1` present, `gpt-4` resolves personally for an anonymous
  // principal AND for the org owner — the org layer adds routes, never rewrites.
  const anon = await qr.buildOrgRoutingContext({ model: "gpt-4" }, null);
  assert.equal(anon.organizationId, null);
  assert.equal(anon.denied, false);

  const memberPrincipal = { userId: owner.id, user: owner, isOrganizationScoped: false };
  const asOwner = await qr.buildOrgRoutingContext({ model: "gpt-4" }, memberPrincipal as never);
  assert.equal(asOwner.organizationId, null, "org membership must not scope a plain model");
  assert.equal(asOwner.denied, false);
  assert.deepEqual(asOwner.connectionIds, []);
});

test("bare combo name still resolves to the personal combo with no principal", async () => {
  const personal = await combosDb.createCombo({
    name: "legacy-personal-combo",
    models: [{ connectionId: "conn-legacy", provider: "openai", model: "gpt-4o", step: 0 }],
  });

  const resolved = await orgCombos.resolveComboInScope({ name: "legacy-personal-combo" }, null);
  assert.ok(resolved, "personal combo must resolve without org context");
  assert.equal(resolved!.id, personal.id);
  assert.equal(resolved!.organizationId ?? null, null, "resolved combo is personal");
});

test("org-scoped combo is unreachable via a bare name (superset, not rewrite)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({
    slug: "team1",
    name: "Team 1",
    ownerUserId: owner.id,
  });

  const ownerCtx = { organizationId: org.id, role: "owner" } as never;
  await orgCombos.createOrganizationCombo(
    org.id,
    { name: "shared-name", models: [{ provider: "openai", model: "gpt-4o", step: 0 }] } as never,
    ownerCtx
  );

  // Bare name → personal namespace only, which has no such combo.
  const bare = await orgCombos.resolveComboInScope({ name: "shared-name" }, null);
  assert.equal(bare, null, "bare name must not reach an org combo");

  // Even with a member context, a bare name stays personal-only.
  const bareAsMember = await orgCombos.resolveComboInScope({ name: "shared-name" }, {
    organizationId: org.id,
    role: "owner",
  } as never);
  assert.equal(bareAsMember, null, "members still get personal-only bare names");
});

test("personal auto route resolves to the unrestricted personal scope", async () => {
  const scope = await autoScope.resolveAutoRoutingScope({ model: "auto:cost" }, null);
  assert.ok(scope, "personal auto scope must resolve");
  assert.equal(scope.scope, "personal", "personal auto is never denied or org-scoped");
  assert.equal(scope.route, "auto:cost");
  assert.equal(
    autoScope.scopedConnectionIdSet(scope),
    null,
    "personal auto scope imposes no connection restriction"
  );
});
