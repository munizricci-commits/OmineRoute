/**
 * auth/userDetails.ts — platform-admin user detail aggregation (Phase 03).
 *
 * Gathers safe user detail (platform role + organization memberships) for the admin
 * user-detail view. Authorization is enforced by the caller (requirePlatformAdminUser);
 * this module assumes the caller is a platform admin. No secrets are returned.
 *
 * @module lib/auth/userDetails
 */

import { getUserById } from "@/lib/db/users";
import { getUserMemberships } from "@/lib/db/members";
import { isPlatformAdmin, type UserRecord } from "@/lib/org/principal";

export class UserNotFoundError extends Error {
  constructor(message = "User not found") {
    super(message);
    this.name = "UserNotFoundError";
  }
}

export interface SafeUserDetail {
  id: string;
  email: string | null;
  displayName: string | null;
  loginIdentifier: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  platformRole: string;
  memberships: Array<{
    organizationId: string;
    userId: string;
    role: string;
    status: string;
  }>;
}

/**
 * Build safe user detail for an admin viewer. `viewer` must be a platform admin
 * (enforced by the route). Returns null if the target user does not exist.
 */
export async function getUserDetailsForAdmin(
  _viewer: UserRecord,
  userId: string
): Promise<SafeUserDetail | null> {
  // The viewer gate is enforced by requirePlatformAdminUser at the route layer.
  // Defensively assert, but do not treat a non-admin as an error type change.
  if (!isPlatformAdmin(_viewer)) {
    throw new Error("Platform administrator access required");
  }
  const user = await getUserById(userId);
  if (!user) return null;
  const memberships = await getUserMemberships(userId);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    loginIdentifier: user.loginIdentifier,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    platformRole: user.role,
    memberships: memberships.map((m) => ({
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role,
      status: m.status,
    })),
  };
}
