/**
 * P10.02 — api-key-regression: REGRESSION ANCHOR proving legacy personal
 * API-key authentication is UNAFFECTED by the Organizations layer
 * (Invariant #1).
 *
 * The org feature added a dashboard-session principal resolver
 * (`resolveDashboardUserPrincipal`, JWT cookie) used only by org-scoped
 * dashboard/API routes. The legacy inference credential path — `Authorization:
 * Bearer sk-...` (plus the Anthropic `x-api-key` fallback) → `extractApiKey` →
 * `isValidApiKey` / `getApiKeyMetadata` — must keep working exactly as before,
 * with NO organization membership required and NO org lookup involved.
 *
 * Adds NO production code. What is pinned here:
 *   1. A freshly created personal API key authenticates via `isValidApiKey` and
 *      resolves metadata via `getApiKeyMetadata` with no org data in the DB.
 *   2. `extractApiKey` still honours `Authorization: Bearer` and the gated
 *      `x-api-key` (anthropic-version) fallback.
 *   3. Creating an organization and NOT making the key's user a member does not
 *      change the outcome — org membership is irrelevant to personal key auth.
 *   4. An unknown/garbage key is still rejected (fail-closed, unchanged).
 *   5. The personal key-auth module does not import the org authorization layer
 *      (no coupling introduced).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-compat-apikey-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";
delete process.env.OMNIROUTE_API_KEY;
delete process.env.ROUTER_API_KEY;

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const sseAuth = await import("../../src/sse/services/auth.ts");

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

test("legacy personal API key authenticates with no organization data present", async () => {
  const created = await apiKeysDb.createApiKey("legacy-personal", "machine-legacy-1", []);
  assert.ok(created?.key, "personal key creation must still work");

  assert.equal(
    await sseAuth.isValidApiKey(created.key),
    true,
    "personal key must authenticate through the legacy path"
  );

  const meta = await apiKeysDb.getApiKeyMetadata(created.key);
  assert.ok(meta, "personal key metadata must resolve");
  assert.equal(meta!.id, created.id);
});

test("extractApiKey still reads Authorization: Bearer", () => {
  const key = sseAuth.extractApiKey({
    headers: new Headers({ Authorization: "Bearer sk-legacy-token" }),
  } as never);
  assert.equal(key, "sk-legacy-token");
});

test("extractApiKey still honours the gated anthropic x-api-key fallback", () => {
  const key = sseAuth.extractApiKey({
    headers: new Headers({ "x-api-key": "sk-ant-legacy", "anthropic-version": "2023-06-01" }),
  } as never);
  assert.equal(key, "sk-ant-legacy");
});

test("organization membership is irrelevant to personal API-key auth", async () => {
  const created = await apiKeysDb.createApiKey("legacy-personal-2", "machine-legacy-2", []);

  // Baseline: authenticates before any org exists.
  assert.equal(await sseAuth.isValidApiKey(created.key), true);

  // Create an org whose owner is an unrelated user; the key holder is NOT a member.
  const owner = await usersDb.createUser({ role: "user" });
  await orgsDb.createOrganization({ slug: "team1", name: "Team 1", ownerUserId: owner.id });

  // Still authenticates — org authz never gates the personal key path.
  assert.equal(
    await sseAuth.isValidApiKey(created.key),
    true,
    "non-member personal key must still authenticate"
  );
  const meta = await apiKeysDb.getApiKeyMetadata(created.key);
  assert.ok(meta, "metadata resolution must not require org membership");
  assert.equal(meta!.id, created.id);
});

test("unknown API keys are still rejected (fail-closed, unchanged)", async () => {
  assert.equal(await sseAuth.isValidApiKey("sk-does-not-exist-at-all"), false);
  assert.equal(await sseAuth.isValidApiKey(""), false);
  assert.equal(await sseAuth.isValidApiKey(null as never), false);
  assert.equal(await apiKeysDb.getApiKeyMetadata("sk-does-not-exist-at-all"), null);
});

test("legacy key-auth source does not depend on the org authorization layer", () => {
  const authSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "sse", "services", "auth.ts"),
    "utf8"
  );
  assert.equal(
    /from\s+["'][^"']*lib\/org\//.test(authSrc),
    false,
    "src/sse/services/auth.ts must not import the org layer"
  );
});
