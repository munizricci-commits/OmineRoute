/**
 * 08-github-oauth / Task 02 — GitHub OAuth configuration with secret-safe persistence.
 *
 * TDD: fails before lib/db/githubOAuthConfig.ts exists, then passes. Config is a
 * singleton; client_secret is encrypted at rest; readers never return plaintext.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghcfg-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { getGithubOAuthConfig, setGithubOAuthConfig, isGithubOAuthEnabled } =
  await import("../../src/lib/db/githubOAuthConfig.ts");

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

test("default config is disabled and empty", async () => {
  const cfg = await getGithubOAuthConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.clientId, "");
  // Never expose the secret in the read model.
  assert.equal(cfg.clientSecret, undefined);
  assert.equal(await isGithubOAuthEnabled(), false);
});

test("setGithubOAuthConfig persists and encrypts the secret", async () => {
  await setGithubOAuthConfig({
    clientId: "myclient",
    clientSecret: "super-secret",
    redirectUri: "https://x.io/cb",
    enabled: true,
  });
  const cfg = await getGithubOAuthConfig();
  assert.equal(cfg.clientId, "myclient");
  assert.equal(cfg.redirectUri, "https://x.io/cb");
  assert.equal(cfg.enabled, true);
  // Secret never returned in plaintext.
  assert.equal(cfg.clientSecret, undefined);
  assert.equal(await isGithubOAuthEnabled(), true);

  // Stored blob must not be the plaintext secret.
  const db = core.getDbInstance();
  const row = db
    .prepare(`SELECT client_secret_enc FROM github_oauth_config WHERE id = 1`)
    .get() as {
    client_secret_enc: string;
  };
  assert.notEqual(row.client_secret_enc, "super-secret");
});
