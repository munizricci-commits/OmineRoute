/**
 * db/users.ts — Durable user entity for the Organizations feature (P1 — Identity).
 *
 * Establishes a stable principal identity distinct from the legacy
 * `api_keys.machine_id` binding. A user row is the anchor for organization
 * membership (P2), platform role (P1.03) and inference-key linkage (P1.04).
 *
 * Backward compatibility: existing personal configuration has NO users row and
 * NO api_keys.user_id. This module only adds the entity; it never requires a
 * user for legacy key authentication (see P1.04 — key semantics unchanged).
 *
 * @module lib/db/users
 */

import { v4 as uuidv4 } from "uuid";
import { getDbInstance, rowToCamel, resetDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";

export type UserRole = "user" | "platform_admin";
export type UserStatus = "active" | "blocked" | "disabled";

export interface UserRecord {
  id: string;
  email: string | null;
  displayName: string | null;
  /** Durable login identifier (login name / email used at the login form). Nullable until Task 03. */
  loginIdentifier: string | null;
  role: UserRole;
  status: UserStatus;
  /** Email verification state. false = pending (must confirm via token); true = verified. */
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email?: string | null;
  displayName?: string | null;
  loginIdentifier?: string | null;
  role?: UserRole;
  status?: UserStatus;
}

export interface UpdateUserInput {
  email?: string | null;
  displayName?: string | null;
  loginIdentifier?: string | null;
  role?: UserRole;
  status?: UserStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampRole(value: unknown): UserRole {
  return value === "platform_admin" ? "platform_admin" : "user";
}

function clampStatus(value: unknown): UserStatus {
  if (value === "blocked") return "blocked";
  if (value === "disabled") return "disabled";
  return "active";
}

/** Allowed characters in a normalized login identifier (email-style or simple name). */
const LOGIN_IDENTIFIER_PATTERN = /^[a-zA-Z0-9._@-]+$/;
const LOGIN_IDENTIFIER_MAX = 128;

/**
 * Normalize a raw login identifier: trim whitespace and lower-case.
 * Returns null for empty/undefined input.
 */
export function normalizeLoginIdentifier(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Validate a normalized login identifier against format rules.
 * Returns `{ ok: true }` or `{ ok: false, error }`.
 */
export function validateLoginIdentifier(
  raw: string | null | undefined
): { ok: true } | { ok: false; error: string } {
  const normalized = normalizeLoginIdentifier(raw);
  if (normalized === null) {
    return { ok: false, error: "login identifier must not be empty" };
  }
  if (normalized.length > LOGIN_IDENTIFIER_MAX) {
    return { ok: false, error: "login identifier exceeds maximum length" };
  }
  if (!LOGIN_IDENTIFIER_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: "login identifier contains invalid characters",
    };
  }
  return { ok: true };
}

/**
 * Resolve and validate a login identifier for create/update, throwing a clear
 * error on invalid input or a collision with another user (fail-closed, no
 * partial state). Returns the normalized value (possibly null to clear).
 */
async function resolveLoginIdentifierForWrite(
  raw: string | null | undefined,
  selfId?: string
): Promise<string | null> {
  const normalized = normalizeLoginIdentifier(raw);
  if (normalized === null) return null; // explicit clear
  const validation = validateLoginIdentifier(normalized);
  if (!validation.ok) {
    throw new Error(`Invalid login identifier: ${validation.error}`);
  }
  const existing = await getUserByLoginIdentifier(normalized);
  if (existing && existing.id !== selfId) {
    throw new Error("Login identifier already in use");
  }
  return normalized;
}

function parseUserRow(row: Record<string, unknown>): UserRecord {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    email: camel.email === null || camel.email === undefined ? null : String(camel.email),
    displayName:
      camel.displayName === null || camel.displayName === undefined
        ? null
        : String(camel.displayName),
    loginIdentifier:
      camel.loginIdentifier === null || camel.loginIdentifier === undefined
        ? null
        : String(camel.loginIdentifier),
    role: clampRole(camel.role),
    status: clampStatus(camel.status),
    emailVerified: camel.emailVerified === 1 || camel.emailVerified === true,
    createdAt: String(camel.createdAt),
    updatedAt: String(camel.updatedAt),
  };
}

/**
 * Create a durable user. Generates a UUID id and stamps created/updated times.
 * Email uniqueness is enforced at the DB layer via a unique index expectation,
 * but we surface a clear error rather than swallowing it.
 */
export async function createUser(input: CreateUserInput = {}): Promise<UserRecord> {
  const db = getDbInstance();
  const id = uuidv4();
  const ts = nowIso();
  const role = clampRole(input.role);
  const status = clampStatus(input.status);
  const email = input.email === undefined ? null : input.email;
  const displayName = input.displayName === undefined ? null : input.displayName;
  const loginIdentifier = await resolveLoginIdentifierForWrite(input.loginIdentifier);

  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, login_identifier, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, email, displayName, loginIdentifier, role, status, ts, ts);

  return (await getUserById(id))!;
}

/**
 * Synchronous variant of createUser for use inside DB transactions (no async boundary).
 * Performs a minimal insert with sync normalization; uniqueness is enforced by the
 * DB unique indexes (caller surfaces the error).
 */
export function createUserSync(input: CreateUserInput = {}): UserRecord {
  const db = getDbInstance();
  const id = uuidv4();
  const ts = nowIso();
  const role = clampRole(input.role);
  const status = clampStatus(input.status);
  const email =
    input.email === undefined || input.email === null
      ? null
      : String(input.email).trim().toLowerCase();
  const displayName = input.displayName === undefined ? null : input.displayName;
  const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier) ?? null;

  db.prepare(
    `INSERT INTO users (id, email, display_name, login_identifier, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, displayName, loginIdentifier, role, status, 0, ts, ts);

  return parseUserRow({
    id,
    email,
    display_name: displayName,
    login_identifier: loginIdentifier,
    role,
    status,
    email_verified: 0,
    created_at: ts,
    updated_at: ts,
  });
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  if (!id) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;
  return row ? parseUserRow(row) : null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  if (!email) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).toLowerCase()) as
    Record<string, unknown> | undefined;
  return row ? parseUserRow(row) : null;
}

export async function getUserByLoginIdentifier(
  loginIdentifier: string
): Promise<UserRecord | null> {
  if (!loginIdentifier) return null;
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT * FROM users WHERE login_identifier = ?`)
    .get(String(loginIdentifier)) as Record<string, unknown> | undefined;
  return row ? parseUserRow(row) : null;
}

/**
 * Resolve a user principal by a login identifier or email (case-insensitive,
 * trimmed). Used by the login flow (Task 04) to bind the session to a specific
 * user when a `login` field is supplied. Returns null when nothing matches.
 */
export async function resolveUserByIdentifierOrEmail(
  login: string | null | undefined
): Promise<UserRecord | null> {
  const normalized = normalizeLoginIdentifier(login);
  if (!normalized) return null;
  const byId = await getUserByLoginIdentifier(normalized);
  if (byId) return byId;
  // Emails are stored lower-cased on write; match the same way.
  const byEmail = await getUserByEmail(normalized);
  return byEmail;
}

/**
 * Backfill a deterministic `login_identifier` for every user that lacks one.
 *
 * Resolution order (deterministic, backward-compatible):
 *  1. email local-part (before '@') when an email is present;
 *  2. "admin" for a platform administrator without an email;
 *  3. `user-<first8charsOfId>` for ordinary users without an email.
 *
 * Collisions within the same batch are disambiguated with a numeric suffix so
 * the new UNIQUE index (Task 03) is never violated. Idempotent: users that
 * already have a login_identifier are never overwritten, and a second call
 * reports zero changes. The management-password is untouched.
 *
 * @returns the number of users that were updated.
 */
export async function backfillUserLoginIdentifiers(): Promise<number> {
  const db = getDbInstance();
  const rows = db.prepare(`SELECT * FROM users WHERE login_identifier IS NULL`).all() as Record<
    string,
    unknown
  >[];
  if (rows.length === 0) return 0;

  const ts = nowIso();
  let changed = 0;
  const taken = new Set<string>();
  const plan: Array<{ id: string; identifier: string }> = [];
  for (const row of rows) {
    const rec = parseUserRow(row);
    let base: string;
    if (rec.email) {
      base = String(rec.email).split("@")[0] || rec.email;
    } else if (rec.role === "platform_admin") {
      base = "admin";
    } else {
      base = `user-${String(rec.id).slice(0, 8)}`;
    }
    // Disambiguate against already-claimed identifiers in this batch and the DB.
    let candidate = normalizeLoginIdentifier(base) ?? base;
    let suffix = 1;
    while (taken.has(candidate) || (await getUserByLoginIdentifier(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    taken.add(candidate);
    plan.push({ id: rec.id, identifier: candidate });
  }

  const updateStmt = db.prepare(
    `UPDATE users SET login_identifier = ?, updated_at = ? WHERE id = ?`
  );
  const tx = db.transaction(() => {
    for (const { id, identifier } of plan) {
      updateStmt.run(identifier, ts, id);
      changed += 1;
    }
  });
  tx();
  return changed;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserRecord | null> {
  const existing = await getUserById(id);
  if (!existing) return null;

  const db = getDbInstance();
  const email =
    input.email === undefined ? existing.email : input.email === null ? null : input.email;
  const displayName =
    input.displayName === undefined
      ? existing.displayName
      : input.displayName === null
        ? null
        : input.displayName;
  const loginIdentifier = await resolveLoginIdentifierForWrite(input.loginIdentifier, id);
  const role = input.role === undefined ? existing.role : clampRole(input.role);
  const status = input.status === undefined ? existing.status : clampStatus(input.status);
  const ts = nowIso();

  await db
    .prepare(
      `UPDATE users SET email = ?, display_name = ?, login_identifier = ?, role = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(email, displayName, loginIdentifier, role, status, ts, id);

  return (await getUserById(id))!;
}

export async function setUserRole(id: string, role: UserRole): Promise<UserRecord | null> {
  return updateUser(id, { role });
}

/**
 * Set the email verification state for a user (P4). Used after a successful
 * verification-token consume, and to mark users verified when SMTP is not
 * configured at registration time.
 */
export async function setUserEmailVerified(
  id: string,
  verified: boolean
): Promise<UserRecord | null> {
  const db = getDbInstance();
  db.prepare(`UPDATE users SET email_verified = ?, updated_at = ? WHERE id = ?`).run(
    verified ? 1 : 0,
    nowIso(),
    id
  );
  return getUserById(id);
}

export async function listUsers(limit = 100, offset = 0): Promise<UserRecord[]> {
  const db = getDbInstance();
  const rows = db
    .prepare(`SELECT * FROM users ORDER BY created_at ASC LIMIT ? OFFSET ?`)
    .all(limit, offset) as Record<string, unknown>[];
  return rows.map(parseUserRow);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = getDbInstance();
  const res = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  return res.changes > 0;
}

// ── Test state reset (mirrors apiKeys.resetApiKeyState) ──────────────────────
let _usersStateResetRegistered = false;
function resetUsersState() {
  // users table is torn down by resetDbInstance(); nothing in-memory to drop.
}
if (typeof registerDbStateResetter === "function" && !_usersStateResetRegistered) {
  try {
    registerDbStateResetter(resetUsersState);
    _usersStateResetRegistered = true;
  } catch {
    // registration is best-effort; tests that need a clean slate call resetDbInstance.
  }
}

export { resetDbInstance };
