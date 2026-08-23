/**
 * db/userCredentials.ts — per-user password credentials (Phase 04).
 *
 * Stores a scrypt-derived password hash per registered user, separate from the legacy
 * management-password bootstrap. Never returns or logs the plaintext.
 *
 * @module lib/db/userCredentials
 */

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";
import { evaluatePassword } from "@/lib/auth/passwordPolicy";

const KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, KEYLEN, SCRYPT_PARAMS).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, derived] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !derived) return false;
  const expected = scryptSync(plain, salt, KEYLEN, SCRYPT_PARAMS);
  const actual = Buffer.from(derived, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Set (or replace) a user's password. Returns nothing; throws on invalid input. */
export async function setUserPassword(userId: string, plain: string): Promise<void> {
  setUserPasswordSync(userId, plain);
}

/** Synchronous variant for use inside DB transactions (no async boundary). */
export function setUserPasswordSync(userId: string, plain: string): void {
  if (!userId || typeof plain !== "string") {
    throw new Error("Password must be a non-empty string");
  }
  const evaluation = evaluatePassword(plain);
  if (!evaluation.valid) {
    throw new Error(evaluation.errors.join("; "));
  }
  const ts = new Date().toISOString();
  const db = getDbInstance();
  db.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       updated_at = excluded.updated_at`
  ).run(userId, hashPassword(plain), ts, ts);
}

/** Verify a user's password against the stored hash. Returns false if no credential. */
export async function verifyUserPassword(userId: string, plain: string): Promise<boolean> {
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT password_hash FROM user_credentials WHERE user_id = ?`)
    .get(userId) as { password_hash: string } | undefined;
  if (!row) return false;
  try {
    return verifyPassword(plain, row.password_hash);
  } catch {
    return false;
  }
}

/** Whether the user has a registered password credential. */
export async function hasUserPassword(userId: string): Promise<boolean> {
  const db = getDbInstance();
  const row = db.prepare(`SELECT 1 FROM user_credentials WHERE user_id = ?`).get(userId);
  return !!row;
}

// ── Test state reset ──────────────────────────────────────────────────────────
let _registered = false;
function resetUserCredentialsState() {
  // table torn down by resetDbInstance(); nothing in-memory.
}
if (typeof registerDbStateResetter === "function" && !_registered) {
  try {
    registerDbStateResetter(resetUserCredentialsState);
    _registered = true;
  } catch {
    /* best-effort */
  }
}
