/**
 * 06-password-recovery / Task 01 — one-time, expiring password reset tokens.
 *
 * TDD: fails before lib/db/passwordReset.ts + migration exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pwreset-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const {
  createPasswordResetToken,
  consumePasswordResetToken,
  getPasswordResetTokenMeta,
  PASSWORD_RESET_TOKEN_TTL_MS,
} = await import("../../src/lib/db/passwordReset.ts");

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

test("createPasswordResetToken stores a hashed, expiring, unused token", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 16);
  const meta = await getPasswordResetTokenMeta(token);
  assert.ok(meta);
  assert.equal(meta!.userId, u.id);
  assert.equal(meta!.used, false);
  assert.ok(meta!.expiresAt > Date.now());
});

test("consumePasswordResetToken is atomic and one-time", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  const meta = await consumePasswordResetToken(token);
  assert.ok(meta);
  assert.equal(meta!.userId, u.id);
  // Second consume must fail (already used).
  const again = await consumePasswordResetToken(token);
  assert.equal(again, null);
});

test("expired tokens are not consumable", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  const db = core.getDbInstance();
  const tokenHash = db
    .prepare(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ?`)
    .get(u.id).token_hash;
  db.prepare(`UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?`).run(
    new Date(Date.now() - 1000).toISOString(),
    tokenHash
  );
  const meta = await consumePasswordResetToken(token);
  assert.equal(meta, null);
});

test("TTL is a positive, reasonable duration", () => {
  assert.ok(PASSWORD_RESET_TOKEN_TTL_MS > 0);
  assert.ok(PASSWORD_RESET_TOKEN_TTL_MS <= 1000 * 60 * 60 * 24 * 2); // <= 48h
});
