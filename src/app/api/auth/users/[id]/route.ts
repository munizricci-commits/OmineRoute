/**
 * GET /api/auth/users/:id
 *
 * Platform-admin-only user detail: safe summary + platform role + organization
 * memberships. Authorization enforced server-side (fail-closed). No secrets.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { getUserDetailsForAdmin } from "@/lib/auth/userDetails";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const admin = await requirePlatformAdminUser(request);
    const { id } = await ctx.params;
    const detail = await getUserDetailsForAdmin(admin, id);
    if (!detail) {
      return NextResponse.json(buildErrorBody("not_found", "User not found"), { status: 404 });
    }
    return NextResponse.json(detail);
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
    return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
      status: 401,
    });
  }
}
