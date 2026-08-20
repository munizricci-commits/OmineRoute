/**
 * Pure derivation of whether the Register control should be shown, from the
 * server-backed instance auth settings (Task 05).
 */
import type { InstanceAuthSettings } from "@/lib/db/instanceAuthSettings";

export function deriveRegistrationAllowed(
  settings: InstanceAuthSettings | null | undefined
): boolean {
  if (!settings) return false;
  return settings.multiUserEnabled === true && settings.registrationPolicy !== "disabled";
}
