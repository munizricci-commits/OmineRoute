/**
 * auth/platformAdminAuth.ts — reusable platform-admin authorization gate.
 *
 * Resolves the dashboard principal from a request and returns the underlying user
 * only if they hold the platform_admin role. Fail-closed: missing/invalid session
 * or a non-admin principal throws PlatformAdminRequiredError (callers map it to
 * 401/403). Reused by all platform-admin-only endpoints.
 *
 * @module lib/auth/platformAdminAuth
 */

import type { UserRecord } from "@/lib/db/users";
import { resolveDashboardUserPrincipal, isPlatformAdmin } from "@/lib/org/principal";
import { PlatformAdminRequiredError } from "@/lib/auth/instanceSettingsService";

export { PlatformAdminRequiredError } from "@/lib/auth/instanceSettingsService";

/** Thrown when there is no valid dashboard session (maps to HTTP 401). */
export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Resolve the request's user and assert they are a platform administrator.
 * - No valid session -> throws UnauthenticatedError (401).
 * - Authenticated but not a platform admin -> throws PlatformAdminRequiredError (403).
 * - Platform admin -> returns the user.
 */
export async function requirePlatformAdminUser(request: Request): Promise<UserRecord> {
  const principal = await resolveDashboardUserPrincipal(request);
  if (!principal) {
    throw new UnauthenticatedError();
  }
  if (!isPlatformAdmin(principal.user)) {
    throw new PlatformAdminRequiredError();
  }
  return principal.user;
}
