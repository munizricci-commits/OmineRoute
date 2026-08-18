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
