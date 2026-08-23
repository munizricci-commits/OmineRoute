/**
 * POST /api/organizations/:organizationId/invitations
 *
 * Create an organization invitation. Authorized only for the platform admin or
 * the organization owner (policy enforcement). Validates the target email and
 * persists a pending, expiring invitation. Fails closed on auth.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveDashboardUserPrincipal, isPlatformAdmin } from "@/lib/org/principal";
import { getOrganizationById } from "@/lib/db/organizations";
import { createInvitation } from "@/lib/db/invitations";
import { sendInvitationEmail } from "@/lib/auth/invitationEmailService";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

const schema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["owner", "moderator", "user"]).default("user"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> }
) {
  const principal = await resolveDashboardUserPrincipal(request);
  if (!principal || !principal.user) {
    return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
      status: 401,
    });
  }
  const actor = principal.user;
  const isAdmin = isPlatformAdmin(actor);

  const { organizationId } = await context.params;
  const org = await getOrganizationById(organizationId);
  if (!org) {
    return NextResponse.json(buildErrorBody("not_found", "Organization not found"), {
      status: 404,
    });
  }

  // Org owner may invite; everyone else needs platform-admin.
  const isOwner = org.ownerUserId === actor.id;
  if (!isAdmin && !isOwner) {
    return NextResponse.json(buildErrorBody("forbidden", "Not authorized to invite"), {
      status: 403,
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid JSON body"), { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid email"), { status: 400 });
  }

  const invitation = await createInvitation({
    organizationId: org.id,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: actor.id,
  });

  // Best-effort email dispatch. If SMTP is unconfigured the transport is a noop
  // and this is a silent success; delivery failures must NOT roll back the
  // invitation (fail-closed: the invite still exists, admin can resend).
  try {
    await sendInvitationEmail({
      organizationName: org.name,
      email: invitation.email,
      token: invitation.token,
      invitedBy: actor.email,
    });
  } catch {
    // Swallow — invitation creation succeeded; email is best-effort.
  }

  return NextResponse.json(
    {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    },
    { status: 201 }
  );
}
