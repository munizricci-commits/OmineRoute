/**
 * GET/POST /api/auth/instance-settings
 *
 * Platform-admin-only endpoint for reading and changing instance-wide
 * authentication settings (multi-user mode, registration policy). Authorization is
 * enforced server-side via the resolved dashboard principal — UI visibility of the
 * toggle is never a substitute (fail-closed).
 */

import { NextResponse } from "next/server";
import { resolveDashboardUserPrincipal } from "@/lib/org/principal";
import {
  getAuthSettingsForAdmin,
  updateAuthSettingsForAdmin,
  PlatformAdminRequiredError,
} from "@/lib/auth/instanceSettingsService";
import { getInstanceAuthSettings } from "@/lib/db/instanceAuthSettings";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export async function GET(request: Request) {
  // Public, read-only projection of the registration-relevant policy flags.
  // The payload carries only non-sensitive instance auth policy (no credentials),
  // so it is safe to serve without authentication — the /login page needs it to
  // decide whether to surface the "Register" control for an unauthenticated
  // visitor. Mutating the policy stays admin-only via POST below.
  try {
    const settings = await getInstanceAuthSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error("[instance-settings] GET failed:", err);
    return NextResponse.json(buildErrorBody("internal_error", "Failed to read settings"), {
      status: 500,
    });
  }
}

const ALLOWED_KEYS = new Set(["multiUserEnabled", "registrationPolicy"]);

export async function POST(request: Request) {
  try {
    const principal = await resolveDashboardUserPrincipal(request);
    if (!principal) {
      return NextResponse.json(buildErrorBody("unauthorized", "Authentication required"), {
        status: 401,
      });
    }

    let raw: Record<string, unknown>;
    try {
      raw = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(buildErrorBody("invalid_request", "Invalid JSON body"), {
        status: 400,
      });
    }

    const input: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (ALLOWED_KEYS.has(key)) input[key] = raw[key];
    }
    if (Object.keys(input).length === 0) {
      return NextResponse.json(buildErrorBody("invalid_request", "No allowed settings provided"), {
        status: 400,
      });
    }

    const settings = await updateAuthSettingsForAdmin(principal.user, input as never);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof PlatformAdminRequiredError) {
      return NextResponse.json(
        buildErrorBody("forbidden", "Platform administrator access required"),
        {
          status: 403,
        }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to update settings";
    const status = /registration policy/i.test(message) ? 400 : 500;
    return NextResponse.json(buildErrorBody("update_failed", message), { status });
  }
}
