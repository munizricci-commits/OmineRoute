/**
 * db/instanceAuthSettings.ts — Persisted instance-wide authentication settings.
 *
 * Singleton configuration for the Organizations auth roadmap (Phase 02). A fresh
 * database reads sensible defaults: multi-user mode OFF, registration disabled.
 * This module never touches provider credentials and does not create a parallel
 * auth/routing system — it only stores the instance auth policy flags.
 *
 * @module lib/db/instanceAuthSettings
 */

import { getDbInstance, resetDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";

export type RegistrationPolicy = "disabled" | "invite-only";

export interface InstanceAuthSettings {
  multiUserEnabled: boolean;
  registrationPolicy: RegistrationPolicy;
}

export interface SetInstanceAuthSettingsInput {
  multiUserEnabled?: boolean;
  registrationPolicy?: RegistrationPolicy;
}

const SINGLETON_ID = "singleton";
const ALLOWED_POLICIES: RegistrationPolicy[] = ["disabled", "invite-only"];

function nowIso(): string {
  return new Date().toISOString();
}

function clampPolicy(value: unknown): RegistrationPolicy {
  return value === "invite-only" ? "invite-only" : "disabled";
}

/**
 * Read the current instance auth settings. Returns defaults when no row exists
 * yet (fresh database): multi-user OFF, registration disabled.
 */
export async function getInstanceAuthSettings(): Promise<InstanceAuthSettings> {
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM instance_auth_settings WHERE id = ?`).get(SINGLETON_ID) as
    Record<string, unknown> | undefined;
  if (!row) {
    return { multiUserEnabled: false, registrationPolicy: "disabled" };
  }
  return {
    multiUserEnabled: row.multi_user_enabled === 1,
    registrationPolicy: clampPolicy(row.registration_policy),
  };
}

/**
 * Upsert the singleton instance auth settings. Validates the registration policy
 * (fail-closed) and persists atomically. Returns the persisted settings.
 */
export async function setInstanceAuthSettings(
  input: SetInstanceAuthSettingsInput = {}
): Promise<InstanceAuthSettings> {
  if (
    input.registrationPolicy !== undefined &&
    !ALLOWED_POLICIES.includes(input.registrationPolicy)
  ) {
    throw new Error(`Invalid registration policy: ${String(input.registrationPolicy)}`);
  }

  const current = await getInstanceAuthSettings();
  const multiUserEnabled = input.multiUserEnabled ?? current.multiUserEnabled;
  const registrationPolicy = input.registrationPolicy ?? current.registrationPolicy;
  const ts = nowIso();

  const db = getDbInstance();
  db.prepare(
    `INSERT INTO instance_auth_settings (id, multi_user_enabled, registration_policy, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       multi_user_enabled = excluded.multi_user_enabled,
       registration_policy = excluded.registration_policy,
       updated_at = excluded.updated_at`
  ).run(SINGLETON_ID, multiUserEnabled ? 1 : 0, registrationPolicy, ts);

  return { multiUserEnabled, registrationPolicy };
}

// ── Test state reset ──────────────────────────────────────────────────────────
let _registered = false;
function resetInstanceAuthState() {
  // table torn down by resetDbInstance(); nothing in-memory.
}
if (typeof registerDbStateResetter === "function" && !_registered) {
  try {
    registerDbStateResetter(resetInstanceAuthState);
    _registered = true;
  } catch {
    /* best-effort */
  }
}

export { resetDbInstance };
