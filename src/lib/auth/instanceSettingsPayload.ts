/**
 * Pure payload builder for instance auth settings (Task 03).
 * Keeps only allowed keys; never sends secrets or unrelated fields.
 */
export interface InstanceSettingsPayload {
  multiUserEnabled?: boolean;
  registrationPolicy?: "disabled" | "invite-only";
}

export function buildInstanceSettingsPayload(
  multiUserEnabled?: boolean,
  registrationPolicy?: "disabled" | "invite-only"
): InstanceSettingsPayload {
  const payload: InstanceSettingsPayload = {};
  if (typeof multiUserEnabled === "boolean") payload.multiUserEnabled = multiUserEnabled;
  if (registrationPolicy === "disabled" || registrationPolicy === "invite-only") {
    payload.registrationPolicy = registrationPolicy;
  }
  return payload;
}
