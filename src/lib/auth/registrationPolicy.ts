/**
 * Pure, client-safe derivation of registration visibility.
 * Contains NO server-only imports (no DB drivers) so it can be bundled into the
 * client login page without pulling in better-sqlite3.
 */

export type RegistrationPolicy = "disabled" | "invite-only";

export interface RegistrationVisibility {
  multiUserEnabled: boolean;
  registrationPolicy: RegistrationPolicy;
}

/** Whether the Register control should be shown, given resolved visibility. */
export function isRegistrationAllowed(
  visibility: RegistrationVisibility | null | undefined
): boolean {
  if (!visibility) return false;
  return visibility.multiUserEnabled === true && visibility.registrationPolicy !== "disabled";
}
