/**
 * db/emailVerification.ts — one-time, expiring email verification tokens (P4).
 *
 * Design mirrors passwordReset.ts (Phase 06, Task 01): the raw token is
 * generated here, returned to the caller ONCE (to put in the email link), and
 * never stored. Only a SHA-256 hash is persisted, so a DB breach cannot yield
 * usable tokens. Tokens are single-use and time-limited; consumption is atomic
 * (verify + mark used inside one transaction).
 *
 * @module lib/db/emailVerification
 */

import { randomBytes, createHash } from "node:crypto";
import { getDbInstance } from "./core";

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface EmailVerificationMeta {
  userId: string;
  email: string | null;
  expiresAt: number;
  used: boolean;
}

/** Create a verification token for a user/email. Returns the RAW token (show once). */
export async function createEmailVerificationToken(
  userId: string,
  email: string | null
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS).toISOString();
  const db = getDbInstance();
  db.prepare(
    `INSERT INTO email_verification_tokens (token_hash, user_id, email, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(tokenHash, userId, email ?? null, expiresAt, nowIso());
  return raw;
}

/** Look up token metadata by RAW token (without consuming it). */
export async function getEmailVerificationTokenMeta(
  rawToken: string
): Promise<EmailVerificationMeta | null> {
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT user_id, email, expires_at, used FROM email_verification_tokens WHERE token_hash = ?`
    )
    .get(hashToken(rawToken)) as
    { user_id: string; email: string | null; expires_at: string; used: number } | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    expiresAt: new Date(row.expires_at).getTime(),
    used: row.used === 1,
  };
}

/**
 * Atomically verify + consume a verification token. Returns the meta (with userId)
 * on success, or null if unknown, already used, or expired. Marked used in the
 * same transaction that reads it (single-use guarantee).
 */
export async function consumeEmailVerificationToken(
  rawToken: string
): Promise<EmailVerificationMeta | null> {
  const db = getDbInstance();
  const tokenHash = hashToken(rawToken);
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT user_id, email, expires_at, used FROM email_verification_tokens WHERE token_hash = ?`
      )
      .get(tokenHash) as
      { user_id: string; email: string | null; expires_at: string; used: number } | undefined;
    if (!row) return null;
    if (row.used === 1) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    db.prepare(
      `UPDATE email_verification_tokens SET used = 1, consumed_at = ? WHERE token_hash = ?`
    ).run(nowIso(), tokenHash);
    return {
      userId: row.user_id,
      email: row.email,
      expiresAt: new Date(row.expires_at).getTime(),
      used: true,
    };
  });
  return tx();
}

/** Count non-consumed, non-expired verification tokens for a user. */
export async function countVerificationTokensForUser(userId: string): Promise<number> {
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM email_verification_tokens WHERE user_id = ? AND used = 0 AND expires_at > ?`
    )
    .get(userId, new Date().toISOString()) as { c: number };
  return row.c;
}
