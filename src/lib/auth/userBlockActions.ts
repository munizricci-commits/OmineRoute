/**
 * Pure helper for the block/unblock action UI (Task 07). Given the current account
 * status, returns the status that the primary toggle action would apply, and the
 * label to show. "active" -> block; anything else -> unblock (restore to active).
 */
import type { UserAccountStatus } from "@/lib/auth/userStatus";

export function nextBlockActionStatus(
  current: UserAccountStatus | string | undefined
): UserAccountStatus {
  return current === "active" ? "blocked" : "active";
}

export function blockActionLabel(current: UserAccountStatus | string | undefined): string {
  return current === "active" ? "block" : "unblock";
}
