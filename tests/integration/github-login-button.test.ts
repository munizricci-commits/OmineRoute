/**
 * 08-github-oauth / Task 05 — GitHub login button gating (TDD, integration).
 *
 * require-login must surface githubOAuthEnabled so the login page can show the
 * button only when OAuth is configured. When OAuth is off, the field is false
 * and the button stays hidden (no unconfigured redirect target leaked).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghbtn-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { setGithubOAuthConfig } = await import("../../src/lib/db/githubOAuthConfig.ts");
const routeMod = await import("../../src/app/api/settings/require-login/route.ts");

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

test("require-login reports githubOAuthEnabled=false by default", async () => {
  const res = await routeMod.GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.githubOAuthEnabled, false);
});

test("require-login reports githubOAuthEnabled=true when configured", async () => {
  await setGithubOAuthConfig({
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "https://x.io/cb",
    enabled: true,
  });
  const res = await routeMod.GET();
  const body = await res.json();
  assert.equal(body.githubOAuthEnabled, true);
});
