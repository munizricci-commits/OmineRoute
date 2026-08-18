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
import type {
  OrganizationContext,
  ResourceScope,
  ConnectionVisibility,
  ConnectionCredentialFields,
} from "./types";

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

/**
 * Credential field names stripped from a connection unless visibility is `full`.
 * Mirrors the (future) `src/lib/db/providerConnections.ts` credential columns;
 * `redactConnectionCredentials` operates on any object carrying these fields.
 */
export const CREDENTIAL_FIELDS = ["apiKey", "apiSecret", "password", "bearerToken"] as const;

/** Minimal shape of a provider connection needed for the secret boundary. */
export interface ConnectionRef {
  scope: ResourceScope;
  /** Owner user id — authoritative for `personal` connections. */
  ownerUserId?: string | null;
  /** Owning org id — authoritative for `organization` connections. */
  organizationId?: string | null;
}

/**
 * Resolve whether a viewer may see a connection's credential material.
 *
 * Contract:
 *  - `full`  — the viewer may read `apiKey`/`apiSecret`/`password`/`bearerToken`.
 *  - `usable`— the viewer may route through the connection but MUST NOT receive
 *              credential fields.
 *
 * Rules (fail-closed → `usable`):
 *  - a `personal` connection is `full` only for its own owner;
 *  - an `organization` connection is `full` for an owner/moderator of the owning
 *    org (or a `platformAdminOverride` context), `usable` for ordinary members;
 *  - any non-member / missing context is `usable` (never `full`).
 */
export function resolveConnectionVisibility(
  ctx: OrganizationContext | null,
  viewerUserId: string,
  connection: ConnectionRef
): ConnectionVisibility {
  if (connection.scope === "personal") {
    return connection.ownerUserId === viewerUserId ? "full" : "usable";
  }

  // organization-scoped connection: must belong to the SAME org the context is
  // resolved for (prevents cross-org credential disclosure).
  if (!ctx || ctx.organizationId !== connection.organizationId) return "usable";
  if (ctx.role === "owner" || ctx.role === "moderator" || ctx.platformAdminOverride === true) {
    return "full";
  }
  return "usable";
}

/**
 * Return a copy of `conn` with credential fields removed unless `visibility` is
 * `full`. The original is never mutated. Field stripping is the *mechanism*; the
 * *policy* lives in `resolveConnectionVisibility` (P4 performs the actual
 * field removal when serializing connections).
 */
export function redactConnectionCredentials<T extends ConnectionCredentialFields>(
  conn: T,
  visibility: ConnectionVisibility
): T {
  if (visibility === "full") return { ...conn };
  const copy = { ...(conn as Record<string, unknown>) };
  for (const field of CREDENTIAL_FIELDS) {
    delete copy[field];
  }
  return copy as T;
}
