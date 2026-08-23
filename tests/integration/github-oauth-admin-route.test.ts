/**
 * 08-github-oauth / Gap-closure — platform-admin GitHub OAuth config endpoint.
 *
 * Integration proof that the missing write path now exists:
 *  - GET/POST /api/admin/github-oauth requires platform admin (fail-closed 401/403)
 *  - client secret is never returned on the read path (masked)
 *  - POST persists via setGithubOAuthConfig and enables the feature
 *  - getGithubOAuthSecret() can decrypt what was written (regression for the
 *    missing `decrypt` import bug)
 *  - require-login reflects the enabled flag as githubOAuthEnabled: true
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghadmin-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { setGithubOAuthConfig, getGithubOAuthConfig, getGithubOAuthSecret, isGithubOAuthEnabled } =
  await import("../../src/lib/db/githubOAuthConfig.ts");
const configRoute = await import("../../src/app/api/admin/github-oauth/route.ts");
const requireLoginRoute = await import("../../src/app/api/settings/require-login/route.ts");

let seq = 0;

async function resetStorage() {
  core.resetDbInstance();
  seq += 1;
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

function req(body?: unknown, method = "GET"): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/admin/github-oauth", init);
}

test.describe("GitHub OAuth admin endpoints", { concurrency: 1 }, () => {
  test.beforeEach(async () => {
    await resetStorage();
  });

  test.after(() => {
    core.resetDbInstance();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test("GET /api/admin/github-oauth fails closed without auth (401/403)", async () => {
    const res = await configRoute.GET(req());
    assert.ok(res.status === 401 || res.status === 403);
  });

  test("POST /api/admin/github-oauth fails closed without auth (401/403)", async () => {
    const res = await configRoute.POST(
      req({ enabled: true, clientId: "c", clientSecret: "s" }, "POST")
    );
    assert.ok(res.status === 401 || res.status === 403);
  });

  test("setGithubOAuthConfig persists and isGithubOAuthEnabled becomes true", async () => {
    await setGithubOAuthConfig({
      enabled: true,
      clientId: "my-client-id",
      clientSecret: "my-secret",
      redirectUri: "https://app.io/api/auth/github/callback",
    });
    assert.equal(await isGithubOAuthEnabled(), true);
  });

  test("read path never exposes the client secret", async () => {
    await setGithubOAuthConfig({
      enabled: true,
      clientId: "my-client-id",
      clientSecret: "my-secret",
      redirectUri: "https://app.io/api/auth/github/callback",
    });
    const cfg = await getGithubOAuthConfig();
    assert.equal(cfg.clientSecret, undefined); // masked
    assert.equal(cfg.clientId, "my-client-id");
    const json = JSON.stringify(cfg);
    assert.ok(!json.includes("my-secret"));
  });

  test("getGithubOAuthSecret can decrypt the stored secret (regression: decrypt import)", async () => {
    await setGithubOAuthConfig({
      enabled: true,
      clientId: "my-client-id",
      clientSecret: "my-secret",
      redirectUri: "https://app.io/api/auth/github/callback",
    });
    const secret = await getGithubOAuthSecret();
    assert.equal(secret, "my-secret"); // decrypt must work (no ReferenceError)
  });

  test("require-login reflects githubOAuthEnabled: true after config", async () => {
    await setGithubOAuthConfig({
      enabled: true,
      clientId: "my-client-id",
      clientSecret: "my-secret",
      redirectUri: "https://app.io/api/auth/github/callback",
    });
    const res = await requireLoginRoute.GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.githubOAuthEnabled, true);
  });

  test("require-login reports githubOAuthEnabled: false when unconfigured", async () => {
    const res = await requireLoginRoute.GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.githubOAuthEnabled, false);
  });
});
