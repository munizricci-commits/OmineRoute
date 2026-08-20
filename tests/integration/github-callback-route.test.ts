/**
 * 08-github-oauth / Task 04 — callback route edge validation (TDD, integration).
 *
 * Covers the fail-closed guards on GET /api/auth/github/callback: missing
 * code/state, and unknown/expired single-use state. The happy path that hits
 * GitHub's network is exercised by the unit tests for resolveOrProvisionGitHubUser.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghcbrt-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const routeMod = await import("../../src/app/api/auth/github/callback/route.ts");

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

test("callback rejects when code or state is missing", async () => {
  const res = await routeMod.GET(new Request("http://localhost/api/auth/github/callback"));
  assert.equal(res.status, 400);

  const withCode = await routeMod.GET(
    new Request("http://localhost/api/auth/github/callback?code=abc")
  );
  assert.equal(withCode.status, 400);
});

test("callback rejects an unknown/expired single-use state", async () => {
  const res = await routeMod.GET(
    new Request("http://localhost/api/auth/github/callback?code=abc&state=doesnotexist")
  );
  assert.equal(res.status, 403);
});

test("callback redirects on upstream OAuth error", async () => {
  const res = await routeMod.GET(
    new Request("http://localhost/api/auth/github/callback?error=access_denied")
  );
  assert.ok(res.status >= 300 && res.status < 400);
  assert.ok(new URL(res.headers.get("location")!).searchParams.has("oauth_error"));
});
