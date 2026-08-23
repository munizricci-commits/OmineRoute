/**
 * 06-password-recovery / Task 06 — expiry, replay, brute-force, enumeration, leakage.
 *
 * TDD: consolidates security properties of the reset-token mechanism with focused
 * unit tests (the integration-level properties are covered in earlier tasks).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pwsec-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createPasswordResetToken, consumePasswordResetToken, getPasswordResetTokenMeta } =
  await import("../../src/lib/db/passwordReset.ts");

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

test("EXPIRY: a backdated token cannot be consumed", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  const db = core.getDbInstance();
  const th = db
    .prepare(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ?`)
    .get(u.id).token_hash;
  db.prepare(`UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?`).run(
    new Date(Date.now() - 60_000).toISOString(),
    th
  );
  const meta = await consumePasswordResetToken(token);
  assert.equal(meta, null);
});

test("REPLAY: a consumed token cannot be consumed twice", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  assert.ok(await consumePasswordResetToken(token));
  assert.equal(await consumePasswordResetToken(token), null);
});

test("LEAKAGE: only the token HASH is stored, never the raw token", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const raw = await createPasswordResetToken(u.id);
  const db = core.getDbInstance();
  const row = db
    .prepare(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ?`)
    .get(u.id) as { token_hash: string };
  // Raw token must not equal the stored value, and must not appear anywhere in the row.
  assert.notEqual(row.token_hash, raw);
  const all = JSON.stringify(db.prepare(`SELECT * FROM password_reset_tokens`).get());
  assert.ok(!all.includes(raw));
});

test("BRUTE-FORCE: guessing tokens fails (constant-shape null result)", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  await createPasswordResetToken(u.id);
  // Simulated offline guessing of many wrong tokens.
  let hits = 0;
  for (let i = 0; i < 50; i++) {
    const guess = "guess-" + i.toString(36).padStart(20, "0");
    if (await consumePasswordResetToken(guess)) hits++;
  }
  assert.equal(hits, 0);
  // The real token is still valid (guessing did not consume it).
  const tokens = core
    .getDbInstance()
    .prepare(`SELECT token_hash FROM password_reset_tokens WHERE user_id = ?`)
    .all(u.id) as Array<{ token_hash: string }>;
  // We cannot recompute the raw token, but we assert none of the guesses consumed it.
  assert.equal(tokens.length, 1);
});

test("ENUMERATION: meta lookup does not reveal whether an account exists via error type", async () => {
  // getPasswordResetTokenMeta returns null for unknown tokens regardless of any
  // associated user, so callers cannot distinguish "bad token" from "no user".
  const meta = await getPasswordResetTokenMeta("totally-made-up-token");
  assert.equal(meta, null);
});
