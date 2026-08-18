/**
 * types.ts — Shared client-side type contracts for the Organizations dashboard
 * UI (P8.02–P8.06). Mirrors the response envelopes returned by
 * `/api/v1/organizations/*` (see src/lib/org/orgApiService.ts) without
 * importing server-only modules.
 *
 * @module app/(dashboard)/dashboard/organizations/types
 */

export type OrgRole = "owner" | "moderator" | "user";

/** Organization as returned by the list endpoint (with the caller's role). */
export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Full organization record (GET /[id]) plus the viewer's resolved role. */
export interface OrganizationDetail extends OrganizationSummary {
  role: OrgRole;
}

/** Membership row (GET /[id]/members). */
export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: string;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Invitation row (GET /[id]/invitations). */
export interface OrganizationInvitation {
  id?: string;
  token?: string;
  email: string;
  role: OrgRole;
  status: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export type ConnectionVisibility = "usable" | "full";

/**
 * Org-scoped connection as returned by GET /[id]/connections. Credentials are
 * already stripped server-side for non-privileged viewers; `qualifiedRoute` is
 * the display key (e.g. `team1/connection:x`).
 */
export interface OrganizationConnection {
  id: string;
  qualifiedRoute: string;
  visibility: ConnectionVisibility;
  name?: string;
  provider?: string;
  [key: string]: unknown;
}

/**
 * Org-scoped combo as returned by GET /[id]/combos. `qualifiedRoute` is the
 * display key (e.g. `team1/combo:dev`).
 */
export interface OrganizationCombo {
  id?: string;
  name: string;
  qualifiedRoute: string;
  scope: "organization";
  [key: string]: unknown;
}

/** Standard list envelope returned by most org GET endpoints. */
export interface WrappedList<T> {
  object: "list";
  data: T[];
  qualifier?: string;
}

/** Standard item envelope returned by create/get endpoints. */
export interface WrappedItem<T> {
  object: string;
  data: T;
  role?: OrgRole;
  qualifier?: string;
}
