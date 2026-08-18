/**
 * org/authorization.ts — Additive, org-scoped authorization layer (P3).
 *
 * Pure functions, synchronous where possible, testable without HTTP. Reuses the
 * P1 `resolveDashboardUserPrincipal` principal and the P2 `organizations.ts` /
 * `members.ts` data modules. This module is defense-in-depth that sits *alongside*
 * (never replaces) the existing `src/server/authz/*` and
 * `src/lib/api/requireManagementAuth.ts` layers.
 *
 * Server-side authorization here is FAIL-CLOSED: every policy predicate defaults
 * to `false`, and `resolveOrganizationContext` returns `null` for anything that
 * is not a confirmed active membership in an active organization.
 *
 * @module lib/org/authorization
 */

import { getMembership } from "@/lib/db/members";
import { getOrganizationById } from "@/lib/db/organizations";
import type { UserPrincipal } from "./principal";
import type { OrganizationContext } from "./types";

/**
 * Resolve the caller's organization context from their active membership.
 *
 * Fail-closed — returns `null` when:
 *  - the principal is missing or has no `userId`,
 *  - `organizationId` is empty,
 *  - the organization does not exist or is `archived`,
 *  - the principal is not an *active* member of that organization.
 *
 * The organization is always re-resolved from the data layer (never trusted
 * from a client-supplied value) — this is what prevents URL/ID parameter bypass
 * in P3.03.
 */
export async function resolveOrganizationContext(
  principal: UserPrincipal | null | undefined,
  organizationId: string
): Promise<OrganizationContext | null> {
  if (!principal || !principal.userId || !organizationId) return null;

  const org = await getOrganizationById(organizationId);
  if (!org || org.status !== "active") return null;

  const membership = await getMembership(organizationId, principal.userId);
  if (!membership) return null;

  return { organizationId, role: membership.role };
}

/**
 * Construct an explicit owner-like context for a platform_admin operating with
 * full org privileges (audit / support). This is the ONLY sanctioned way for a
 * platform_admin to gain org powers — it flows through the *same* policy
 * predicates below (never a silent branch). The `platformAdminOverride` flag is
 * itself covered by the P3.02 tests.
 */
export function platformAdminOrganizationContext(organizationId: string): OrganizationContext {
  return { organizationId, role: "owner", platformAdminOverride: true };
}

/** True for owner role or an explicit platform_admin override. Fail-closed. */
function isOwnerLike(ctx: OrganizationContext | null | undefined): boolean {
  if (!ctx) return false;
  return ctx.role === "owner" || ctx.platformAdminOverride === true;
}

/**
 * Central org authorization policy. Every predicate is FAIL-CLOSED: an absent
 * (`null`) context is denied, and only the explicitly enumerated role(s) are
 * granted. These functions are pure and exercised directly by the API layer
 * (P3.03) and the secret boundary (P3.04).
 */

/** Any active member (or platform_admin override) may read the organization. */
export function canReadOrganization(ctx: OrganizationContext | null): boolean {
  return ctx != null;
}

/** Any active member (or platform_admin override) may USE org resources. */
export function canUseOrganizationResource(ctx: OrganizationContext | null): boolean {
  return ctx != null;
}

/** Moderators and owners (or platform_admin override) manage routing resources. */
export function canManageOrganizationResource(ctx: OrganizationContext | null): boolean {
  if (!ctx) return false;
  return ctx.role === "moderator" || isOwnerLike(ctx);
}

/** Only owners (or platform_admin override) manage membership. */
export function canManageMembership(ctx: OrganizationContext | null): boolean {
  return isOwnerLike(ctx);
}

/** Only owners (or platform_admin override) may archive the organization. */
export function canArchiveOrganization(ctx: OrganizationContext | null): boolean {
  return isOwnerLike(ctx);
}

/** Only owners (or platform_admin override) may delete the organization. */
export function canDeleteOrganization(ctx: OrganizationContext | null): boolean {
  return isOwnerLike(ctx);
}
