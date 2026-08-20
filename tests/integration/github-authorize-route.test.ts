/**
 * 08-github-oauth / Task 03 — OAuth authorization initiation with state protection.
 *
 * TDD: fails before lib/auth/githubAuthorize.ts + route exist, then passes.
 * The authorize step must (a) refuse when OAuth is unconfigured, (b) mint a
 * single-use expiring CSRF `state` stored server-side, (c) return a GitHub
 * authorize URL carrying that state.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghauth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { setGithubOAuthConfig, getGithubOAuthConfig } =
  await import("../../src/lib/db/githubOAuthConfig.ts");
const { consumeOAuthState } = await import("../../src/lib/db/githubOAuthState.ts");
const authMod = await import("../../src/lib/auth/githubAuthorize.ts");
const routeMod = await import("../../src/app/api/auth/github/authorize/route.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("authorize throws when GitHub OAuth is not configured", async () => {
  await assert.rejects(
    () => authMod.beginGithubAuthorization({ redirectUri: "https://x.io/cb" }),
    /not (configured|enabled)/i
  );
});

test("beginGithubAuthorization mints state + returns authorize URL", async () => {
  await setGithubOAuthConfig({
    clientId: "myclient",
    clientSecret: "secret",
    redirectUri: "https://x.io/cb",
    enabled: true,
  });
  const result = await authMod.beginGithubAuthorization({ redirectUri: "https://x.io/cb" });
  assert.ok(result.state.length >= 32);
  assert.ok(result.authorizeUrl.startsWith("https://github.com/login/oauth/authorize?"));
  assert.ok(result.authorizeUrl.includes(`client_id=myclient`));
  assert.ok(result.authorizeUrl.includes(`state=${result.state}`));
  assert.ok(result.authorizeUrl.includes("scope="));

  // The state must be consumable (stored server-side, single-use).
  const consumed = await consumeOAuthState(result.state);
  assert.ok(consumed);
  assert.equal(consumed!.redirectUri, "https://x.io/cb");
});

test("route GET returns 400 when OAuth unconfigured", async () => {
  const res = await routeMod.GET(new Request("http://localhost/api/auth/github/authorize"));
  assert.equal(res.status, 400);
});

test("route GET returns a redirect-style JSON with authorizeUrl when configured", async () => {
  await setGithubOAuthConfig({
    clientId: "myclient",
    clientSecret: "secret",
    redirectUri: "https://x.io/cb",
    enabled: true,
  });
  const res = await routeMod.GET(new Request("http://localhost/api/auth/github/authorize"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.authorizeUrl.includes("github.com/login/oauth/authorize"));
  assert.ok(typeof body.state === "string" && body.state.length >= 32);
});
