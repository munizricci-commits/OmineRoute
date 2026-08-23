/**
 * db/passwordReset.ts — one-time, expiring password reset tokens (Phase 06, Task 01).
 *
 * Design: the raw token is generated here, returned to the caller ONCE (to put
 * in the email link), and never stored. Only a SHA-256 hash is persisted, so a
 * DB breach cannot yield usable tokens. Tokens are single-use and time-limited;
 * consumption is atomic (verify + mark used inside one transaction).
 */

import { randomBytes, createHash } from "node:crypto";
import { getDbInstance } from "./core";

export const PASSWORD_RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface PasswordResetMeta {
  userId: string;
  expiresAt: number;
  used: boolean;
}

/** Create a reset token for a user. Returns the RAW token (show once). */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString();
  const db = getDbInstance();
  db.prepare(
    `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
  ).run(tokenHash, userId, expiresAt, nowIso());
  return raw;
}

/** Look up token metadata by RAW token (without consuming it). */
export async function getPasswordResetTokenMeta(
  rawToken: string
): Promise<PasswordResetMeta | null> {
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ?`)
    .get(hashToken(rawToken)) as { user_id: string; expires_at: string; used: number } | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).getTime(),
    used: row.used === 1,
  };
}

/**
 * Atomically verify + consume a reset token. Returns the meta (with userId) on
 * success, or null if the token is unknown, already used, or expired. The token
 * is marked used in the same transaction that reads it (single-use guarantee).
 */
export async function consumePasswordResetToken(
  rawToken: string
): Promise<PasswordResetMeta | null> {
  const db = getDbInstance();
  const tokenHash = hashToken(rawToken);
  const tx = db.transaction(() => {
    const row = db
      .prepare(`SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ?`)
      .get(tokenHash) as { user_id: string; expires_at: string; used: number } | undefined;
    if (!row) return null;
    if (row.used === 1) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    db.prepare(
      `UPDATE password_reset_tokens SET used = 1, consumed_at = ? WHERE token_hash = ?`
    ).run(nowIso(), tokenHash);
    return { userId: row.user_id, expiresAt: new Date(row.expires_at).getTime(), used: true };
  });
  return tx();
}

/** Count non-consumed, non-expired reset tokens for a user (used by tests/audit). */
export async function countResetTokensForUser(userId: string): Promise<number> {
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ? AND used = 0 AND expires_at > ?`
    )
    .get(userId, new Date().toISOString()) as { c: number };
  return row.c;
}
