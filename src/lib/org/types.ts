/**
 * org/types.ts — Shared type contracts for the Organizations authorization
 * layer (P3). Type-only declarations; no runtime logic.
 *
 * @module lib/org/types
 */

import type { OrgRole } from "@/lib/db/organizations";
import type { UserRecord } from "@/lib/db/users";
import type { UserPrincipal } from "./principal";

export type { OrgRole } from "@/lib/db/organizations";

/**
 * Whether a routing resource (connection / combo) is personal (user-owned) or
 * organization-scoped. Drives the secret-boundary resolution in P3.04.
 */
export type ResourceScope = "personal" | "organization";

/**
 * Resolved authorization context for a user within a single organization.
 *
 * Derived from the authenticated user's *active* membership — `resolveOrganizationContext`
 * returns `null` (fail-closed) when the principal is missing, the org does not
 * exist / is archived, or the principal is not an active member.
 *
 * `platformAdminOverride` flags a platform_admin acting with full org privileges
 * for audit/support. It is an explicit, *tested* flag — never a silent
 * special-case. Callers construct an override context via
 * `platformAdminOrganizationContext()` rather than mutating role checks inline.
 */
export interface OrganizationContext {
  organizationId: string;
  role: OrgRole;
  /** True when a platform_admin is operating with owner-like privileges. */
  platformAdminOverride?: boolean;
}

/** Org-scoped principal: a P1 dashboard user principal bound to an org context. */
export interface OrgPrincipal extends UserPrincipal {
  isOrganizationScoped: true;
  organizationContext: OrganizationContext;
}

/** Discriminated principal shape (reuses P1 `UserPrincipal`). */
export type AnyPrincipal = UserPrincipal | OrgPrincipal;

/** Connection credential visibility contract (P3.04). */
export type ConnectionVisibility = "usable" | "full";

/**
 * Subset of provider-connection fields that constitute credentials. These are
 * stripped from API responses unless the viewer has `full` visibility (P3.04 /
 * P4). Field names match the real credential columns on a provider_connections
 * row after `rowToCamel` (apiKey / accessToken / refreshToken / idToken) and
 * are kept in lockstep with `CREDENTIAL_FIELDS` in `./authorization`.
 */
export interface ConnectionCredentialFields {
  apiKey?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
}
