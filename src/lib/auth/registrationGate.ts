/**
 * auth/registrationGate.ts — server-side registration policy gate (Phase 02).
 *
 * Single source of truth for whether self-registration is currently permitted.
 * Fail-closed: if the settings cannot be read or the state is anything other
 * than multi-user ON with a non-disabled policy, registration is denied. Future
 * registration endpoints must call `assertRegistrationAllowed()` before creating
 * any user (no partial state).
 *
 * @module lib/auth/registrationGate
 */

import { getInstanceAuthSettings } from "@/lib/db/instanceAuthSettings";

/** Thrown when registration is not permitted by the instance policy. */
export class RegistrationNotAllowedError extends Error {
  constructor(message = "Registration is disabled") {
    super(message);
    this.name = "RegistrationNotAllowedError";
  }
}

/**
 * Returns true only when multi-user mode is enabled AND the registration policy
 * is not "disabled". Any read failure falls through to false (fail-closed).
 */
export async function isRegistrationAllowed(): Promise<boolean> {
  try {
    const settings = await getInstanceAuthSettings();
    return settings.multiUserEnabled === true && settings.registrationPolicy !== "disabled";
  } catch {
    return false;
  }
}

/** Resolves if registration is allowed, otherwise throws RegistrationNotAllowedError. */
export async function assertRegistrationAllowed(): Promise<void> {
  if (!(await isRegistrationAllowed())) {
    throw new RegistrationNotAllowedError();
  }
}
