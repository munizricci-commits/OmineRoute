/**
 * org/orgApiService.ts — Request-handler business logic for the Organizations
 * REST API (P8.01). Pure-ish handlers that return standard `Response` objects
 * so they are fully unit-testable without the Next.js runtime; the thin
 * `route.ts` files under `src/app/api/v1/organizations/` only forward to these.
 *
 * Authn/authz contract (fail-closed):
 *  - every handler resolves the dashboard user principal; no principal → 401;
 *  - per-org handlers delegate to `resolveOrgAccess(principal, id, capability)`
 *    which re-resolves the org from the principal's membership (never trusts a
 *    client-supplied id) and throws `OrgAccessDeniedError` (403/404) on denial;
 *  - DB modules enforce finer-grained invariants on top of the route gate.
 *
 * All client errors go through `buildErrorBody` / `sanitizeErrorMessage`.
 *
 * @module lib/org/orgApiService
 */

import { z } from "zod";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { buildErrorBody, sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
import { CORS_HEADERS } from "@/shared/utils/cors";
import { resolveDashboardUserPrincipal } from "./principal";
import { resolveOrgAccess, OrgAccessDeniedError } from "./apiAuth";
import type { OrgAccessCapability } from "./apiAuth";
import {
  createOrganization,
  getOrganizationById,
  updateOrganization,
  archiveOrganization,
  listUserOrganizations,
  OrganizationError,
} from "@/lib/db/organizations";
import {
  addMember,
  removeMember,
  promoteMember,
  demoteMember,
  listMembers,
  MembershipError,
} from "@/lib/db/members";
import {
  createInvitation,
  revokeInvitation,
  listInvitations,
  getInvitationByToken,
  InvitationError,
} from "@/lib/db/invitations";
import { getOrganizationConnections } from "@/lib/db/orgConnections";
import { getOrganizationCombos } from "@/lib/db/orgCombos";
import { resolveConnectionVisibility, redactConnectionCredentials } from "@/lib/org/authorization";

// ── Response helpers (CORS + sanitized errors) ──────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function httpError(status: number, message: string): Response {
  return new Response(JSON.stringify(buildErrorBody(status, sanitizeErrorMessage(message))), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Resolve principal + enforce org capability; returns ctx or throws a 401/403/404. */
async function requireOrg(
  request: Request,
  organizationId: string,
  capability: OrgAccessCapability
): Promise<{ userId: string; ctx: import("./types").OrganizationContext }> {
  const principal = await resolveDashboardUserPrincipal(request);
  if (!principal) throw new OrgAccessDeniedError("Authentication required", 401 as 401);
  try {
    const ctx = await resolveOrgAccess(principal, organizationId, capability);
    return { userId: principal.userId, ctx };
  } catch (err) {
    if (err instanceof OrgAccessDeniedError) throw err;
    throw err;
  }
}

/** Map a DB-domain error to a sanitized HTTP error Response (fail-closed). */
function mapDbError(err: unknown): Response | null {
  if (err instanceof OrganizationError) {
    switch (err.code) {
      case "SLUG_EXISTS":
        return httpError(HTTP_STATUS.CONFLICT ?? 409, "Organization slug already exists");
      case "ORG_NOT_FOUND":
        return httpError(HTTP_STATUS.NOT_FOUND, "Organization not found");
      case "OWNER_NOT_FOUND":
        return httpError(HTTP_STATUS.BAD_REQUEST, "Organization owner not found");
      default:
        return httpError(HTTP_STATUS.BAD_REQUEST, err.message);
    }
  }
  if (err instanceof MembershipError) {
    switch (err.code) {
      case "ORG_NOT_FOUND":
      case "MEMBER_NOT_FOUND":
      case "USER_NOT_FOUND":
        return httpError(HTTP_STATUS.NOT_FOUND, err.message);
      case "NOT_AUTHORIZED":
        return httpError(HTTP_STATUS.FORBIDDEN, err.message);
      case "ROLE_INVALID":
        return httpError(HTTP_STATUS.BAD_REQUEST, err.message);
      case "ALREADY_MEMBER":
      case "OWNER_CANNOT_BE_REMOVED":
      case "LAST_OWNER_PROTECTION":
        return httpError(HTTP_STATUS.CONFLICT ?? 409, err.message);
      default:
        return httpError(HTTP_STATUS.BAD_REQUEST, err.message);
    }
  }
  if (err instanceof InvitationError) {
    switch (err.code) {
      case "ORG_NOT_FOUND":
      case "INVITATION_NOT_FOUND":
        return httpError(HTTP_STATUS.NOT_FOUND, err.message);
      case "NOT_AUTHORIZED":
        return httpError(HTTP_STATUS.FORBIDDEN, err.message);
      case "ROLE_INVALID":
        return httpError(HTTP_STATUS.BAD_REQUEST, err.message);
      case "INVITATION_NOT_PENDING":
        return httpError(HTTP_STATUS.CONFLICT ?? 409, err.message);
      default:
        return httpError(HTTP_STATUS.BAD_REQUEST, err.message);
    }
  }
  return null;
}

/** Wrap a handler body so DB errors are mapped and unexpected errors are sanitized. */
async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OrgAccessDeniedError) {
      return httpError(err.status, err.message);
    }
    const mapped = mapDbError(err);
    if (mapped) return mapped;
    return httpError(HTTP_STATUS.SERVER_ERROR ?? 500, "Internal error");
  }
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case ascii"),
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case ascii")
    .optional(),
});

const AddMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["user", "moderator"]).optional(),
});

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["user", "moderator"]).optional(),
});

const MemberActionSchema = z.object({
  action: z.enum(["promote", "demote"]),
});

// ── param context shapes ────────────────────────────────────────────────────

interface IdParams {
  params: Promise<{ id: string }>;
}
interface IdUserParams {
  params: Promise<{ id: string; userId: string }>;
}
interface IdTokenParams {
  params: Promise<{ id: string; token: string }>;
}
interface TokenParams {
  params: Promise<{ token: string }>;
}

// ── Top-level: create + list ─────────────────────────────────────────────────

export async function createOrganizationHandler(request: Request): Promise<Response> {
  return guard(async () => {
    const principal = await resolveDashboardUserPrincipal(request);
    if (!principal) return httpError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");

    const body = await request.json().catch(() => null);
    const parsed = CreateOrgSchema.safeParse(body);
    if (!parsed.success) {
      return httpError(HTTP_STATUS.BAD_REQUEST, "Invalid organization payload");
    }

    const org = await createOrganization({
      name: parsed.data.name,
      slug: parsed.data.slug,
      ownerUserId: principal.userId,
    });
    return json({ object: "organization", data: org }, HTTP_STATUS.CREATED ?? 201);
  });
}

export async function listOrganizationsHandler(request: Request): Promise<Response> {
  return guard(async () => {
    const principal = await resolveDashboardUserPrincipal(request);
    if (!principal) return httpError(HTTP_STATUS.UNAUTHORIZED, "Authentication required");

    const orgs = await listUserOrganizations(principal.userId);
    return json({ object: "list", data: orgs });
  });
}

// ── Single org: get / update / delete ───────────────────────────────────────

export async function getOrganizationHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const { ctx: orgCtx } = await requireOrg(request, id, "read");
    const org = await getOrganizationById(id);
    if (!org) return httpError(HTTP_STATUS.NOT_FOUND, "Organization not found");
    return json({ object: "organization", data: org, role: orgCtx.role });
  });
}

export async function updateOrganizationHandler(
  request: Request,
  ctx: IdParams
): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    await requireOrg(request, id, "manageResource");

    const body = await request.json().catch(() => null);
    const parsed = UpdateOrgSchema.safeParse(body);
    if (!parsed.success) {
      return httpError(HTTP_STATUS.BAD_REQUEST, "Invalid organization payload");
    }

    const org = await updateOrganization(id, parsed.data);
    if (!org) return httpError(HTTP_STATUS.NOT_FOUND, "Organization not found");
    return json({ object: "organization", data: org });
  });
}

export async function deleteOrganizationHandler(
  request: Request,
  ctx: IdParams
): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    await requireOrg(request, id, "archive");

    const org = await archiveOrganization(id);
    if (!org) return httpError(HTTP_STATUS.NOT_FOUND, "Organization not found");
    return json({ object: "organization", data: org, archived: true });
  });
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembersHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    await requireOrg(request, id, "read");
    const members = await listMembers(id);
    return json({ object: "list", data: members });
  });
}

export async function addMemberHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const { userId: actorUserId } = await requireOrg(request, id, "manageResource");

    const body = await request.json().catch(() => null);
    const parsed = AddMemberSchema.safeParse(body);
    if (!parsed.success) {
      return httpError(HTTP_STATUS.BAD_REQUEST, "Invalid member payload");
    }

    const member = await addMember({
      organizationId: id,
      userId: parsed.data.userId,
      role: parsed.data.role,
      actorUserId,
    });
    return json({ object: "membership", data: member }, HTTP_STATUS.CREATED ?? 201);
  });
}

export async function removeMemberHandler(request: Request, ctx: IdUserParams): Promise<Response> {
  return guard(async () => {
    const { id, userId } = await ctx.params;
    const { userId: actorUserId } = await requireOrg(request, id, "manageResource");

    const ok = await removeMember(id, userId, actorUserId);
    if (!ok) return httpError(HTTP_STATUS.NOT_FOUND, "Member not found");
    return json({ object: "membership", deleted: true, userId });
  });
}

export async function updateMemberHandler(request: Request, ctx: IdUserParams): Promise<Response> {
  return guard(async () => {
    const { id, userId } = await ctx.params;
    const { userId: actorUserId } = await requireOrg(request, id, "manageMembership");

    const body = await request.json().catch(() => null);
    const parsed = MemberActionSchema.safeParse(body);
    if (!parsed.success) {
      return httpError(HTTP_STATUS.BAD_REQUEST, "Invalid member action");
    }

    const member =
      parsed.data.action === "promote"
        ? await promoteMember(id, userId, actorUserId)
        : await demoteMember(id, userId, actorUserId);
    return json({ object: "membership", data: member });
  });
}

// ── Invitations ─────────────────────────────────────────────────────────────

export async function listInvitationsHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    await requireOrg(request, id, "read");
    const invitations = await listInvitations(id);
    return json({ object: "list", data: invitations });
  });
}

export async function createInvitationHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const { userId: actorUserId } = await requireOrg(request, id, "manageResource");

    const body = await request.json().catch(() => null);
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) {
      return httpError(HTTP_STATUS.BAD_REQUEST, "Invalid invitation payload");
    }

    const invitation = await createInvitation({
      organizationId: id,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: actorUserId,
    });
    return json({ object: "invitation", data: invitation }, HTTP_STATUS.CREATED ?? 201);
  });
}

export async function revokeInvitationHandler(
  request: Request,
  ctx: IdTokenParams
): Promise<Response> {
  return guard(async () => {
    const { id, token } = await ctx.params;
    const { userId: actorUserId } = await requireOrg(request, id, "manageResource");

    const ok = await revokeInvitation(token, actorUserId);
    if (!ok) return httpError(HTTP_STATUS.NOT_FOUND, "Invitation not found");
    return json({ object: "invitation", revoked: true, token });
  });
}

/** Public, token-scoped view used by the accept UI. No membership required. */
export async function getInvitationByTokenHandler(
  request: Request,
  ctx: TokenParams
): Promise<Response> {
  return guard(async () => {
    const { token } = await ctx.params;
    const invitation = await getInvitationByToken(token);
    if (!invitation || invitation.status !== "pending") {
      return httpError(HTTP_STATUS.NOT_FOUND, "Invitation not found");
    }
    const org = await getOrganizationById(invitation.organizationId);
    return json({
      object: "invitation",
      data: {
        token: invitation.token,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organization: org
          ? { id: org.id, name: org.name, slug: org.slug }
          : { id: invitation.organizationId },
      },
    });
  });
}

// ── Connections + combos (P8.04 / P8.05 / P8.06 data surfaces) ───────────────

/**
 * List org-scoped connections with credential redaction per viewer visibility.
 * Non-privileged members receive `usable` (credentials stripped); owners and
 * moderators receive `full` (credentials intact).
 */
export async function listConnectionsHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const { userId, ctx: orgCtx } = await requireOrg(request, id, "read");

    const org = await getOrganizationById(id);
    const connections = await getOrganizationConnections(id, orgCtx);
    const visible = connections.map((conn) => {
      const visibility = resolveConnectionVisibility(orgCtx, userId, {
        scope: (conn as Record<string, unknown>).scope as "personal" | "organization" | undefined,
        ownerUserId: (conn as Record<string, unknown>).ownerUserId as string | null | undefined,
        organizationId: (conn as Record<string, unknown>).organizationId as
          string | null | undefined,
      });
      const redacted = redactConnectionCredentials(
        conn as Record<string, unknown>,
        visibility
      ) as Record<string, unknown>;
      return {
        ...redacted,
        visibility,
        qualifiedRoute: `${org?.slug ?? id}/connection:${redacted.id}`,
      };
    });
    return json({
      object: "list",
      qualifier: org?.slug ?? id,
      data: visible,
    });
  });
}

/** List org-scoped combos (qualified routes, e.g. `team1/combo`). */
export async function listCombosHandler(request: Request, ctx: IdParams): Promise<Response> {
  return guard(async () => {
    const { id } = await ctx.params;
    const { ctx: orgCtx } = await requireOrg(request, id, "read");

    const org = await getOrganizationById(id);
    const combos = await getOrganizationCombos(id);
    const data = combos.map((c) => ({
      ...(c as Record<string, unknown>),
      scope: "organization",
      qualifiedRoute: `${org?.slug ?? id}/${(c as Record<string, unknown>).name}`,
    }));
    return json({
      object: "list",
      qualifier: org?.slug ?? id,
      data,
    });
  });
}
