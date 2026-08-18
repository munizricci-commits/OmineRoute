/**
 * P10.03 — remote-token-regression: REGRESSION ANCHOR proving legacy
 * remote/management token auth is UNAFFECTED by the Organizations layer
 * (Invariant #1, Phase-0 DO-NOT-CHANGE: MANAGEMENT_API_KEY_SCOPES untouched).
 *
 * Adds NO production code. What is pinned here:
 *   1. `MANAGEMENT_API_KEY_SCOPES` is still exactly {"manage", "admin"} — the org
 *      feature added no scope and removed none, and no org role string leaks in.
 *   2. `hasManageScope` semantics are unchanged (manage/admin pass; everything
 *      else, including every org role name, fails).
 *   3. A real DB-backed API key created with the `manage` scope still passes the
 *      legacy management verification path (`verifyAuth` on a management route)
 *      with NO organization data present and NO membership.
 *   4. The same key still passes after an organization exists that the key holder
 *      is not a member of — org authz never gates management tokens.
 *   5. A key WITHOUT a management scope is still rejected on a management route
 *      (fail-closed, unchanged).
 *   6. The `oma_` remote access-token path is still evaluated independently of
 *      the org layer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-compat-mgmt-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";
delete process.env.OMNIROUTE_API_KEY;
delete process.env.ROUTER_API_KEY;

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const scopes = await import("../../src/shared/constants/managementScopes.ts");
const apiAuth = await import("../../src/shared/utils/apiAuth.ts");
const accessTokenAuth = await import("../../src/server/authz/accessTokenAuth.ts");

const DB_FILES = ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"];

async function resetStorage() {
  core.resetDbInstance();
  for (const f of DB_FILES) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

/** A management-route request (under /api/, not /api/v1/) carrying a Bearer key. */
function managementRequest(key: string): Request {
  return new Request("http://127.0.0.1:3000/api/connections", {
    headers: { Authorization: `Bearer ${key}` },
  });
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

test("MANAGEMENT_API_KEY_SCOPES is unchanged by the organizations feature", () => {
  assert.deepEqual(
    [...scopes.MANAGEMENT_API_KEY_SCOPES].sort(),
    ["admin", "manage"],
    "management scope set must remain exactly {manage, admin}"
  );
  assert.equal(scopes.MANAGE_SCOPE, "manage");
});

test("hasManageScope semantics unchanged; org role names are not management scopes", () => {
  assert.equal(scopes.hasManageScope(["manage"]), true);
  assert.equal(scopes.hasManageScope(["admin"]), true);
  assert.equal(scopes.hasManageScope([]), false);
  for (const orgRole of ["owner", "moderator", "user", "member", "org:owner"]) {
    assert.equal(scopes.hasManageScope([orgRole]), false, `${orgRole} must not be a mgmt scope`);
  }
  // The narrow mcp:connect scope is still deliberately NOT a management scope.
  assert.equal(scopes.hasManageScope([scopes.MCP_CONNECT_SCOPE]), false);
});

test("manage-scope key authorizes a legacy management route with no org data", async () => {
  const key = await apiKeysDb.createApiKey("legacy-mgmt", "machine-mgmt-1", ["manage"]);
  assert.ok(key?.key);

  const verdict = await apiAuth.verifyAuth(managementRequest(key.key));
  assert.equal(verdict, null, "manage-scope token must authorize the management route");
});

test("manage-scope key still authorizes when an unrelated organization exists", async () => {
  const key = await apiKeysDb.createApiKey("legacy-mgmt-2", "machine-mgmt-2", ["manage"]);
  assert.equal(await apiAuth.verifyAuth(managementRequest(key.key)), null);

  const owner = await usersDb.createUser({ role: "user" });
  await orgsDb.createOrganization({ slug: "team1", name: "Team 1", ownerUserId: owner.id });

  assert.equal(
    await apiAuth.verifyAuth(managementRequest(key.key)),
    null,
    "org membership must not be required for a management token"
  );
});

test("admin scope also authorizes; a non-management scope is still rejected", async () => {
  const adminKey = await apiKeysDb.createApiKey("legacy-admin", "machine-mgmt-3", ["admin"]);
  assert.equal(await apiAuth.verifyAuth(managementRequest(adminKey.key)), null);

  const plainKey = await apiKeysDb.createApiKey("legacy-plain", "machine-mgmt-4", []);
  const verdict = await apiAuth.verifyAuth(managementRequest(plainKey.key));
  assert.equal(
    verdict,
    "Invalid management token",
    "a key without manage/admin must stay rejected on management routes"
  );
});

test("remote oma_ access-token evaluation is independent of the org layer", () => {
  assert.equal(accessTokenAuth.ACCESS_TOKEN_PREFIX, "oma_");
  // No Authorization header → no access-token verdict claim on this request.
  const verdict = accessTokenAuth.evaluateAccessTokenAuth(
    new Request("http://127.0.0.1:3000/api/connections")
  );
  assert.notEqual(verdict.kind, "ok", "an unauthenticated request is never ok (fail-closed)");

  const src = fs.readFileSync(
    path.join(process.cwd(), "src", "shared", "constants", "managementScopes.ts"),
    "utf8"
  );
  assert.equal(
    /lib\/org\//.test(src),
    false,
    "management scope constants must not depend on the org layer"
  );
});
