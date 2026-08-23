/**
 * GET/POST /api/admin/smtp
 *
 * Platform-admin-only SMTP configuration. GET returns the config without the
 * password (masked). POST persists (password encrypted at rest by smtpConfig).
 * Authorization is enforced server-side and fails closed.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { getSmtpConfig, setSmtpConfig } from "@/lib/db/smtpConfig";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { z } from "zod";

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(512).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().max(512).nullable().optional(),
  password: z.string().max(2000).nullable().optional(),
  from: z.string().trim().max(512).nullable().optional(),
});

export async function GET() {
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
  const cfg = await getSmtpConfig();
  return NextResponse.json({
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    // password intentionally omitted
  });
}

export async function POST(request: Request) {
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
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid JSON body"), { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid SMTP configuration"), {
      status: 400,
    });
  }
  const cfg = await setSmtpConfig(parsed.data);
  return NextResponse.json({
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
  });
}
