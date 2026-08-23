/**
 * POST /api/admin/smtp/test
 *
 * Platform-admin-only SMTP connection test. Runs a configuration/connection
 * check and returns the result. Never leaks the password. Fails closed on auth.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { testSmtpConnection } from "@/lib/email/smtpTransport";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export async function POST() {
  try {
    await requirePlatformAdminUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
        status: 401,
      });
    }
    if (err instanceof PlatformAdminRequiredError) {
      return NextResponse.json(buildErrorBody("forbidden", "Platform admin required"), {
        status: 403,
      });
    }
    throw err;
  }
  const result = await testSmtpConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
