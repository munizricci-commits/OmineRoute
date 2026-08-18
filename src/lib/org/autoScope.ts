/**
 * org/autoScope.ts — routing-scope context for AUTO routes (P7.01).
 *
 * PHASE 7 propagates a *routing scope* (personal | organization) through the
 * auto-routing call graph so that an org-qualified auto route
 * (`team1/auto:coding`) selects candidates ONLY from that organization's
 * connections, and so intra-request failover stays inside that pool.
 *
 * This module is deliberately THIN and mostly PURE — it does not route, rank,
 * or fail over. It wraps the P6 `buildOrgRoutingContext` resolver and reshapes
 * its result into the minimal context that `virtualFactory`'s candidate
 * discovery (P7.02) and the existing failover path (P7.04) consume. It never
 * forks the auto/combo engine (Invariant #3).
 *
 * FAIL-CLOSED: an org qualifier that does not resolve to an active membership
 * yields `{ scope: "denied" }` — NOT a personal fallback. Falling back to
 * personal would silently widen the credential scope of a request the caller is
 * not authorized for, so a denied scope allows *no* candidates at all. The
 * caller (chat route) already maps the P6 `denied` signal to a 404.
 *
 * @module lib/org/autoScope
 */

import { buildOrgRoutingContext, type ModelBody, type OrgRoutingContext } from "./qualifiedRoute";
import type { OrganizationContext } from "./types";
import type { UserPrincipal } from "./principal";

/** Personal (legacy) scope — the candidate pool is unrestricted. */
export interface PersonalRoutingScope {
  scope: "personal";
  route: string;
}

/** Organization scope — the candidate pool is restricted to `connectionIds`. */
export interface OrganizationRoutingScope {
  scope: "organization";
  route: string;
  organizationId: string;
  organizationSlug?: string;
  /** The organization's own connection ids — the ONLY allowed candidates. */
  connectionIds: string[];
  ctx: OrganizationContext | null;
}

/** Fail-closed scope — an org qualifier was present but is not authorized. */
export interface DeniedRoutingScope {
  scope: "denied";
  route: string;
}

/** Discriminated routing scope threaded through auto candidate discovery. */
export type RoutingScope = PersonalRoutingScope | OrganizationRoutingScope | DeniedRoutingScope;

/** Injection seam so the scope logic is unit-testable without a database. */
export interface ResolveAutoRoutingScopeOptions {
  resolveOrgRoutingContext?: (
    body: ModelBody | null | undefined,
    principal: UserPrincipal | null | undefined
  ) => Promise<OrgRoutingContext>;
}

/**
 * True when a bare route targets the auto engine. Accepts both the qualified
 * `auto:<strategy>` form and the built-in `auto/<variant>` form, plus plain
 * `auto`. Must NOT prefix-match unrelated names such as `autopilot`.
 */
export function isAutoRoute(route: string): boolean {
  if (typeof route !== "string" || route.length === 0) return false;
  return route === "auto" || route.startsWith("auto:") || route.startsWith("auto/");
}

/**
 * Resolve the routing scope for a request body's `model`.
 *
 * Returns `{ scope: "personal" }` for legacy/unqualified models,
 * `{ scope: "organization", organizationId, connectionIds }` for an authorized
 * org-qualified route, and `{ scope: "denied" }` when an org qualifier is
 * present but unauthorized/unresolvable (fail-closed).
 *
 * A resolver failure is fail-closed for org-qualified models and a no-op for
 * bare personal models (which never needed the resolver in the first place).
 */
export async function resolveAutoRoutingScope(
  body: ModelBody | null | undefined,
  principal: UserPrincipal | null | undefined,
  opts?: ResolveAutoRoutingScopeOptions
): Promise<RoutingScope> {
  const resolve = opts?.resolveOrgRoutingContext ?? buildOrgRoutingContext;

  const rawModel =
    body && typeof body === "object" && "model" in body ? (body as ModelBody).model : undefined;
  const model = typeof rawModel === "string" ? rawModel : "";

  let orgCtx: OrgRoutingContext;
  try {
    orgCtx = await resolve(body, principal);
  } catch {
    // Fail closed only when an org qualifier could be involved; a model with no
    // `/` can never be org-qualified, so it stays personal.
    return model.includes("/")
      ? { scope: "denied", route: model }
      : { scope: "personal", route: model };
  }

  const route = orgCtx?.route ?? model;

  if (orgCtx?.denied) {
    return { scope: "denied", route };
  }

  if (orgCtx?.organizationId) {
    return {
      scope: "organization",
      route,
      organizationId: orgCtx.organizationId,
      organizationSlug: orgCtx.organizationSlug,
      connectionIds: Array.isArray(orgCtx.connectionIds) ? orgCtx.connectionIds : [],
      ctx: orgCtx.ctx ?? null,
    };
  }

  return { scope: "personal", route };
}

/**
 * The set of connection ids a scope permits, or `null` when unrestricted
 * (personal). A denied scope yields an EMPTY set — allowing nothing.
 */
export function scopedConnectionIdSet(scope: RoutingScope | null | undefined): Set<string> | null {
  if (!scope || scope.scope === "personal") return null;
  if (scope.scope === "denied") return new Set<string>();
  return new Set<string>(scope.connectionIds || []);
}

/**
 * Whether a single connection id is permitted under the scope. Fail-closed: a
 * missing/unknown connection id is rejected under any restricted scope.
 */
export function scopeAllowsConnection(
  scope: RoutingScope | null | undefined,
  connectionId: string | null | undefined
): boolean {
  const allowed = scopedConnectionIdSet(scope);
  if (allowed === null) return true;
  if (!connectionId) return false;
  return allowed.has(connectionId);
}
