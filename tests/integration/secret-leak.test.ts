/**
 * 09-security-hardening / Task 04 — secrets never leak (TDD, integration).
 *
 * Guards the contract that sensitive material is never returned by read paths:
 *  - password reset tokens are stored hashed; the raw token is never readable
 *  - GitHub OAuth client_secret is encrypted at rest and masked on read
 *  - SMTP password is encrypted at rest and masked on read
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec04-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createPasswordResetToken, getPasswordResetTokenMeta } =
  await import("../../src/lib/db/passwordReset.ts");
const { getGithubOAuthConfig, setGithubOAuthConfig } =
  await import("../../src/lib/db/githubOAuthConfig.ts");
const { getSmtpConfig, setSmtpConfig } = await import("../../src/lib/db/smtpConfig.ts");

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

test("reset token is stored hashed; raw token is never returned", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const raw = await createPasswordResetToken(u.id);
  assert.ok(raw && raw.length >= 16);
  const meta = await getPasswordResetTokenMeta(raw);
  assert.ok(meta);
  // The stored representation must not equal the raw token (it is hashed).
  const db = core.getDbInstance();
  const row = db
    .prepare(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ?`)
    .get(u.id) as {
    token_hash: string;
  };
  assert.notEqual(row.token_hash, raw);
  assert.ok(row.token_hash.length >= 32);
});

test("GitHub OAuth client_secret is encrypted at rest and masked on read", async () => {
  await setGithubOAuthConfig({
    clientId: "cid",
    clientSecret: "super-secret",
    redirectUri: "https://x.io/cb",
    enabled: true,
  });
  const cfg = await getGithubOAuthConfig();
  assert.equal(cfg.clientId, "cid");
  assert.equal(cfg.clientSecret, undefined); // masked
  const db = core.getDbInstance();
  const row = db
    .prepare(`SELECT client_secret_enc FROM github_oauth_config WHERE id = 1`)
    .get() as {
    client_secret_enc: string;
  };
  assert.notEqual(row.client_secret_enc, "super-secret");
  assert.ok(row.client_secret_enc.length > 0);
});

test("SMTP password is encrypted at rest and masked on read", async () => {
  await setSmtpConfig({
    host: "smtp.x.io",
    port: 587,
    user: "user@x.io",
    password: "smtp-pass",
    fromAddress: "noreply@x.io",
    enabled: true,
  });
  const cfg = await getSmtpConfig();
  assert.equal(cfg.user, "user@x.io");
  assert.equal(cfg.password, undefined); // masked
  const db = core.getDbInstance();
  const row = db.prepare(`SELECT password FROM smtp_config WHERE id = 'singleton'`).get() as {
    password: string;
  };
  assert.notEqual(row.password, "smtp-pass");
  assert.ok(row.password.length > 0);
});
