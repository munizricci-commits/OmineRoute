/**
 * org/apiAuth.ts — Request-handler authorization gate for organization endpoints
 * (P3.03). Thin and pure/testable; it does NOT define API routes (those are P8).
 *
 * SECURITY (bypass prevention): the organization is ALWAYS re-resolved from the
 * authenticated principal's *membership* in the data layer. A client-supplied
 * `organizationId` (path/query/body) is never trusted as proof of access — if it
 * does not correspond to an active membership the principal holds, access is
 * denied. This defeats URL/ID parameter bypass attempts (e.g. a non-member
 * supplying someone else's org id, or a tampered/guessed id).
 *
 * Fail-closed: missing session → 404 (existence not revealed); non-member →
 * 404; member lacking the required capability → 403.
 *
 * @module lib/org/apiAuth
 */

import { resolveDashboardUserPrincipal, isPlatformAdmin } from "./principal";
import type { UserPrincipal } from "./principal";
import {
  resolveOrganizationContext,
  platformAdminOrganizationContext,
  canReadOrganization,
  canUseOrganizationResource,
  canManageOrganizationResource,
  canManageMembership,
  canArchiveOrganization,
  canDeleteOrganization,
} from "./authorization";
import type { OrganizationContext } from "./types";

/** Capabilities a caller may request against an organization endpoint. */
export type OrgAccessCapability =
  "read" | "use" | "manageResource" | "manageMembership" | "archive" | "delete";

/**
 * Thrown when org access is denied. `status` is 404 (no access / not found —
 * existence not revealed) or 403 (authenticated member lacking capability).
 * Routes translate this into a sanitized response; the message here is generic
 * and never echoes raw errors.
 */
export class OrgAccessDeniedError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 404
  ) {
    super(message);
    this.name = "OrgAccessDeniedError";
  }
}

/** Map a capability to the central policy predicate (single source of truth). */
function capabilityAllowed(ctx: OrganizationContext, capability: OrgAccessCapability): boolean {
  switch (capability) {
    case "read":
      return canReadOrganization(ctx);
    case "use":
      return canUseOrganizationResource(ctx);
    case "manageResource":
      return canManageOrganizationResource(ctx);
    case "manageMembership":
      return canManageMembership(ctx);
    case "archive":
      return canArchiveOrganization(ctx);
    case "delete":
      return canDeleteOrganization(ctx);
    default:
      return false;
  }
}

/**
 * Resolve org access for an already-authenticated principal. Fail-closed.
 *
 * The `organizationId` is re-resolved against the principal's membership; a
 * non-member (or a principal supplying an org they are not a member of) is
 * denied with 404. A member lacking the required capability is denied with 403.
 *
 * A `platform_admin` is granted an explicit owner-like override context (via
 * `platformAdminOrganizationContext`) that still flows through the same
 * `capabilityAllowed` predicate — never a silent branch.
 */
export async function resolveOrgAccess(
  principal: UserPrincipal | null | undefined,
  organizationId: string,
  capability: OrgAccessCapability
): Promise<OrganizationContext> {
  if (!principal) {
    throw new OrgAccessDeniedError("Organization access denied", 404);
  }

  if (isPlatformAdmin(principal.user)) {
    const ctx = platformAdminOrganizationContext(organizationId);
    if (!capabilityAllowed(ctx, capability)) {
      throw new OrgAccessDeniedError("Insufficient organization capability", 403);
    }
    return ctx;
  }

  const ctx = await resolveOrganizationContext(principal, organizationId);
  if (!ctx) {
    throw new OrgAccessDeniedError("Organization access denied", 404);
  }
  if (!capabilityAllowed(ctx, capability)) {
    throw new OrgAccessDeniedError("Insufficient organization capability", 403);
  }
  return ctx;
}

/**
 * Request-handler helper for org API routes (P8). Resolves the dashboard user
 * principal from the session, then enforces org access via `resolveOrgAccess`.
 * Returns the resolved context, or throws `OrgAccessDeniedError` (403/404).
 */
export async function requireOrganizationAccess(
  request: Request,
  organizationId: string,
  capability: OrgAccessCapability
): Promise<OrganizationContext> {
  const principal = await resolveDashboardUserPrincipal(request);
  return resolveOrgAccess(principal, organizationId, capability);
}
