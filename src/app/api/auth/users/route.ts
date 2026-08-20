/**
 * GET /api/auth/users
 *
 * Platform-admin-only listing of instance users with safe summary fields.
 * Authorization is enforced server-side (fail-closed). No secrets (password,
 * hashes, tokens) are ever returned.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { listUsers } from "@/lib/db/users";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

// Fields safe to expose in a user summary (no secrets).
function toSafeSummary(u: {
  id: string;
  email: string | null;
  displayName: string | null;
  loginIdentifier: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    loginIdentifier: u.loginIdentifier,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function GET(request: Request) {
  try {
    const admin = await requirePlatformAdminUser(request);
    void admin;
    const users = await listUsers(1000, 0);
    return NextResponse.json({ users: users.map(toSafeSummary) });
  } catch (err) {
    if (err instanceof PlatformAdminRequiredError) {
      // Authenticated but not a platform admin.
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
    // Unexpected error.
    return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
      status: 401,
    });
  }
}
