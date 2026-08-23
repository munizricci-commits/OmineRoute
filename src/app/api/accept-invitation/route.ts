/**
 * POST /api/accept-invitation
 *
 * Accept an organization invitation. This is the account-setup / join step:
 *  - validates the token (unknown -> 404, already-used/revoked/expired -> 409)
 *  - finds or creates the user for the invitation email (invitations are NOT
 *    credentials, but acceptance links an identity to the org)
 *  - joins the org via a membership row (authorized by the invitation itself)
 *  - marks the invitation accepted (single-use, atomic)
 * Fails closed: no token reuse, no cross-org leakage.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getInvitationByToken, acceptInvitation } from "@/lib/db/invitations";
import { getUserByEmail, createUserSync } from "@/lib/db/users";
import { getOrganizationById } from "@/lib/db/organizations";
import { addMember, MembershipError } from "@/lib/db/members";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

const schema = z.object({
  token: z.string().min(16),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid JSON body"), { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid token"), { status: 400 });
  }
  const token = parsed.data.token;

  const meta = await getInvitationByToken(token);
  if (!meta) {
    return NextResponse.json(buildErrorBody("not_found", "Invitation not found"), { status: 404 });
  }
  if (meta.status !== "pending") {
    return NextResponse.json(buildErrorBody("conflict", "Invitation already used or revoked"), {
      status: 409,
    });
  }
  if (meta.expiresAt <= Date.now()) {
    return NextResponse.json(buildErrorBody("gone", "Invitation expired"), { status: 409 });
  }

  // Find or create the identity for the invited email.
  const email = meta.email;
  let user = await getUserByEmail(email);
  if (!user) {
    user = createUserSync({ role: "user", email });
  }

  const org = await getOrganizationById(meta.organizationId);
  if (!org) {
    return NextResponse.json(buildErrorBody("not_found", "Organization not found"), {
      status: 404,
    });
  }

  // Mark accepted first (single-use, atomic). Returns null on race / reuse.
  const accepted = await acceptInvitation(token, user.id);
  if (!accepted) {
    return NextResponse.json(buildErrorBody("conflict", "Invitation already used or revoked"), {
      status: 409,
    });
  }

  // Join the org. The invitation itself authorizes the join, so we act as the
  // org owner (who always exists as a member). If already a member, treat as ok.
  try {
    await addMember({
      organizationId: meta.organizationId,
      userId: user.id,
      role: (meta.role as "owner" | "moderator" | "user") ?? "user",
      invitedBy: meta.invitedBy,
      actorUserId: org.ownerUserId,
    });
  } catch (err) {
    if (err instanceof MembershipError && /already/i.test(err.message)) {
      // Already a member — acceptable (idempotent join).
    } else {
      throw err;
    }
  }

  return NextResponse.json({
    ok: true,
    userId: user.id,
    organizationId: meta.organizationId,
    role: meta.role,
  });
}
