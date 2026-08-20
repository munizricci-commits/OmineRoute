/**
 * auth/userAdminService.ts — platform-admin account status changes (Phase 03).
 *
 * Central service for administrative block/unblock. Enforces invariants:
 *  - caller must be a platform admin (enforced upstream by requirePlatformAdminUser,
 *    re-asserted here defensively);
 *  - protected accounts (platform admins) cannot have their status changed by another
 *    admin (the last-admin / self-lockout protection is strengthened in Task 08);
 *  - status is normalized via normalizeUserStatus (safe default active).
 *
 * @module lib/auth/userAdminService
 */

import { getUserById, updateUser } from "@/lib/db/users";
import { isPlatformAdmin, type UserRecord } from "@/lib/org/principal";
import { normalizeUserStatus, type UserAccountStatus } from "@/lib/auth/userStatus";

export class ProtectedUserError extends Error {
  constructor(message = "Protected account cannot be modified") {
    super(message);
    this.name = "ProtectedUserError";
  }
}

export class UserAdminError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_AUTHORIZED" | "USER_NOT_FOUND" | "PROTECTED"
  ) {
    super(message);
    this.name = "UserAdminError";
  }
}

/**
 * Set a user's account status as a platform admin. Returns the updated status.
 * Throws UserAdminError on protected/unknown/forbidden.
 */
export async function setUserAccountStatus(
  actor: UserRecord,
  userId: string,
  status: string
): Promise<UserAccountStatus> {
  if (!isPlatformAdmin(actor)) {
    throw new UserAdminError("Platform administrator access required", "NOT_AUTHORIZED");
  }
  const target = await getUserById(userId);
  if (!target) {
    throw new UserAdminError(`User '${userId}' not found`, "USER_NOT_FOUND");
  }
  // Protected: platform admins cannot be blocked/unblocked by another admin.
  if (isPlatformAdmin(target)) {
    throw new UserAdminError("Protected account cannot be modified", "PROTECTED");
  }
  const next = normalizeUserStatus(status);
  await updateUser(userId, { status: next });
  return next;
}
