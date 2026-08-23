/**
 * POST /api/auth/users/:id/status
 *
 * Platform-admin-only account status change (block/unblock). Authorization enforced
 * server-side (fail-closed). Protected accounts (platform admins) are rejected with 409.
 * No secrets are exposed.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { setUserAccountStatus, UserAdminError } from "@/lib/auth/userAdminService";
import { normalizeUserStatus } from "@/lib/auth/userStatus";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const admin = await requirePlatformAdminUser(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    const status = normalizeUserStatus(body?.status);
    const updated = await setUserAccountStatus(admin, id, status);
    return NextResponse.json({ id, status: updated });
  } catch (err) {
    if (err instanceof PlatformAdminRequiredError) {
      return NextResponse.json(
        buildErrorBody("forbidden", "Platform administrator access required"),
        {
          status: 403,
        }
      );
    }
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
        status: 401,
      });
    }
    if (err instanceof UserAdminError && err.code === "PROTECTED") {
      return NextResponse.json(buildErrorBody("conflict", "Protected account cannot be modified"), {
        status: 409,
      });
    }
    if (err instanceof UserAdminError && (err.code === "SELF" || err.code === "LAST_ADMIN")) {
      return NextResponse.json(buildErrorBody("conflict", err.message), {
        status: 409,
      });
    }
    if (err instanceof UserAdminError && err.code === "USER_NOT_FOUND") {
      return NextResponse.json(buildErrorBody("not_found", "User not found"), { status: 404 });
    }
    return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
      status: 401,
    });
  }
}
