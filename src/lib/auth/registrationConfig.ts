/**
 * Server-side resolution of registration-visibility for the public login page.
 *
 * The Register button on /login is shown to UNAUTHENTICATED visitors, so its
 * backing policy must be readable without a session. We resolve it from two
 * sources, in priority order:
 *
 *   1. Config (env) — OMNIROUTE_MULTI_USER_ENABLED + OMNIROUTE_REGISTRATION_POLICY.
 *      This is the operator-facing control the login page reads; it can be set
 *      at deploy time without touching the DB.
 *   2. DB fallback — the persisted instance_auth_settings row (PlatformAdmin
 *      changes via the dashboard). Used when env is not explicitly set.
 *
 * The payload carries only non-sensitive policy flags (no credentials).
 *
 * This module imports a DB-backed module (better-sqlite3); it MUST only be used
 * on the server (API routes), never from a "use client" component.
 */

import { getInstanceAuthSettings } from "@/lib/db/instanceAuthSettings";
import type { RegistrationPolicy, RegistrationVisibility } from "@/lib/auth/registrationPolicy";

function readMultiUserFromEnv(): boolean | null {
  const raw = process.env.OMNIROUTE_MULTI_USER_ENABLED?.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function readPolicyFromEnv(): RegistrationPolicy | null {
  const raw = process.env.OMNIROUTE_REGISTRATION_POLICY?.trim();
  if (raw === "invite-only") return "invite-only";
  if (raw === "disabled") return "disabled";
  return null;
}

/**
 * Resolve the effective registration visibility.
 * Env wins when explicitly set; otherwise we fall back to the DB row.
 */
export function resolveRegistrationVisibility(): RegistrationVisibility {
  const multiFromEnv = readMultiUserFromEnv();
  const policyFromEnv = readPolicyFromEnv();

  // Fully configured via env — no DB dependency required.
  if (multiFromEnv !== null && policyFromEnv !== null) {
    return { multiUserEnabled: multiFromEnv, registrationPolicy: policyFromEnv };
  }

  // DB fallback (covers the case where only one of the env vars is set, or none).
  try {
    const db = getInstanceAuthSettings();
    return {
      multiUserEnabled: multiFromEnv ?? db.multiUserEnabled === true,
      registrationPolicy:
        policyFromEnv ?? (db.registrationPolicy as RegistrationPolicy) ?? "disabled",
    };
  } catch {
    // DB unavailable — fail safe to a closed registration surface.
    return {
      multiUserEnabled: multiFromEnv ?? false,
      registrationPolicy: policyFromEnv ?? "disabled",
    };
  }
}
