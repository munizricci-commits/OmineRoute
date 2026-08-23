/**
 * GET/POST /api/admin/github-oauth
 *
 * Platform-admin-only GitHub OAuth login configuration. GET returns the config
 * without the client secret (masked). POST persists (client secret encrypted at
 * rest by githubOAuthConfig). Authorization is enforced server-side and fails
 * closed. Mirrors the shape of /api/admin/smtp.
 */

import { NextResponse } from "next/server";
import {
  requirePlatformAdminUser,
  PlatformAdminRequiredError,
  UnauthenticatedError,
} from "@/lib/auth/platformAdminAuth";
import { getGithubOAuthConfig, setGithubOAuthConfig } from "@/lib/db/githubOAuthConfig";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { z } from "zod";

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().trim().max(512).nullable().optional(),
  clientSecret: z.string().max(2000).nullable().optional(),
  redirectUri: z.string().trim().max(1024).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    await requirePlatformAdminUser(request);
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
  const cfg = await getGithubOAuthConfig();
  return NextResponse.json({
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    // clientSecret intentionally omitted (masked on the read path)
  });
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdminUser(request);
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
    return NextResponse.json(buildErrorBody("bad_request", "Invalid GitHub OAuth configuration"), {
      status: 400,
    });
  }
  const cfg = await setGithubOAuthConfig(parsed.data);
  return NextResponse.json({
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
  });
}
