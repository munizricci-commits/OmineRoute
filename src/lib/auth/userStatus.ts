/**
 * Pure user account-status normalization (Task 05).
 *
 * Safe default: any unknown/empty value maps to "active" (fail-open for availability,
 * not security — blocking is explicit and never the implicit default). Whitelisted
 * values: "active" | "blocked" | "disabled" (disabled retained for backward compat).
 */
export type UserAccountStatus = "active" | "blocked" | "disabled";

const VALID: ReadonlySet<string> = new Set(["active", "blocked", "disabled"]);

export function normalizeUserStatus(value: string | null | undefined): UserAccountStatus {
  if (typeof value === "string" && VALID.has(value)) {
    return value as UserAccountStatus;
  }
  return "active";
}
