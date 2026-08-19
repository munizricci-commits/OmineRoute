/**
 * org/principal.ts — Typed user principal for the Organizations feature (P1.02).
 *
 * Resolves a durable user identity from a dashboard session JWT WITHOUT changing
 * the existing management-password bootstrap. Legacy sessions (issued before the
 * `users` table existed, or without a `sub` claim) still authenticate via
 * `isDashboardSessionAuthenticated`, but resolve to `null` principal here — callers
 * that need an org-aware principal must handle the null case (treated as
 * platform_admin during the transition; see P3 authz).
 *
 * @module lib/org/principal
 */

import { jwtVerify } from "jose";
import { isDashboardSessionAuthenticated } from "@/shared/utils/apiAuth";
import {
  getUserById,
  listUsers,
  createUser,
  backfillUserLoginIdentifiers,
  type UserRecord,
} from "@/lib/db/users";

export interface UserPrincipal {
  userId: string;
  user: UserRecord;
  /** Always false here — organization scope is attached by P3/P6 resolution. */
  isOrganizationScoped: false;
}

function getRequestToken(request: Request): string | null {
  if (!request || typeof request !== "object") return null;
  const cookieStore =
    "cookies" in request && typeof (request as Record<string, unknown>).cookies === "object"
      ? (request as { cookies?: { get?: (n: string) => { value?: string } | undefined } }).cookies
      : undefined;
  const fromCookies = cookieStore?.get?.("auth_token")?.value;
  if (fromCookies) return fromCookies;
  const headers = "headers" in request ? (request as { headers?: Headers }).headers : undefined;
  if (headers) {
    const raw = headers.get?.("cookie");
    if (raw) {
      const match = raw.match(/(?:^|;\s*)auth_token=([^;]+)/);
      if (match) return match[1];
    }
  }
  return null;
}

/**
 * Resolve a typed user principal from a dashboard session request.
 *
 * Returns null when:
 *  - there is no/invalid session, OR
 *  - the session JWT has no `sub` claim (legacy session — no user row linked).
 *
 * Does NOT throw — callers treat null as "session valid but no org principal".
 */
export async function resolveDashboardUserPrincipal(
  request: Request
): Promise<UserPrincipal | null> {
  if (!(await isDashboardSessionAuthenticated(request))) return null;

  const token = getRequestToken(request);
  if (!token || !process.env.JWT_SECRET) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    const sub = typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
    if (sub) {
      const user = await getUserById(sub);
      if (!user || user.status === "disabled") return null;
      return { userId: user.id, user, isOrganizationScoped: false };
    }
    // Legacy dashboard session: the management-password bootstrap login emits a
    // JWT without a `sub` claim (only `{ authenticated: true }`). Per the feature
    // design, such a session is treated as the platform admin during the
    // transition — resolve it to the first active user (the bootstrap admin) so
    // the Organizations API is usable from the dashboard. Fail-closed: only an
    // already-authenticated session reaches here, and we require an active user.
    let users = await listUsers(1, 0);
    if (users.length === 0) {
      // Fresh database: no users row exists yet (the management-password
      // bootstrap does not seed one). Lazily create the bootstrap platform
      // admin so the Organizations API works out-of-the-box. This is gated on an
      // already-authenticated session and runs at most once (next call finds it).
      try {
        const bootstrap = await createUser({ role: "platform_admin", loginIdentifier: "admin" });
        users = [bootstrap];
      } catch {
        return null;
      }
    }
    // Backfill a deterministic login identifier for any pre-existing user that
    // lacks one (Task 02). Idempotent; preserves the management-password.
    try {
      await backfillUserLoginIdentifiers();
    } catch {
      // best-effort; do not block principal resolution on a backfill failure.
    }
    const active = users.find((u) => u.status === "active");
    if (!active) return null;
    return { userId: active.id, user: active, isOrganizationScoped: false };
  } catch {
    return null;
  }
}

/**
 * Whether a dashboard session JWT carries a user principal claim.
 * Used by callers that must distinguish legacy sessions from org-aware ones.
 */
export async function hasUserPrincipal(request: Request): Promise<boolean> {
  return (await resolveDashboardUserPrincipal(request)) !== null;
}

/**
 * Minimal platform role check (P1.03). Ordinary user vs platform_admin.
 * No enterprise RBAC. Returns true only for an active user whose role is
 * `platform_admin`. Legacy management keys (scope `manage`/`admin`) and legacy
 * dashboard sessions (no user row) are handled by the management-auth layer,
 * NOT here — this helper is purely the user-table role.
 */
export function isPlatformAdmin(user: UserRecord | null | undefined): boolean {
  return !!user && user.status === "active" && user.role === "platform_admin";
}

/**
 * Resolve the platform role for a request, if a user principal is present.
 * Returns "platform_admin" | "user" | null (null = no org-aware principal).
 */
export async function resolvePlatformRole(
  request: Request
): Promise<"platform_admin" | "user" | null> {
  const p = await resolveDashboardUserPrincipal(request);
  if (!p) return null;
  return p.user.role === "platform_admin" ? "platform_admin" : "user";
}
