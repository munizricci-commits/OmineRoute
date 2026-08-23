/**
 * Client-safe derivation of whether the Register control should be shown on the
 * public /login page, given the resolved registration visibility.
 *
 * Thin alias over `isRegistrationAllowed` (registrationPolicy.ts) so legacy
 * call-sites / tests that import `deriveRegistrationAllowed` from this module
 * keep working. Contains NO server-only imports.
 */

import { isRegistrationAllowed, type RegistrationVisibility } from "./registrationPolicy";

/** Whether the Register control should be shown, given resolved visibility. */
export function deriveRegistrationAllowed(
  visibility: RegistrationVisibility | null | undefined
): boolean {
  return isRegistrationAllowed(visibility);
}
