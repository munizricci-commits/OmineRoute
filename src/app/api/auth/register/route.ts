/**
 * POST /api/auth/register
 *
 * Public registration endpoint, gated by the instance registration policy. No auth
 * required (this is how new users join). Fail-closed: disabled -> 403, invalid ->
 * 400. Passwords are hashed and never returned. Errors are sanitized.
 */

import { NextResponse } from "next/server";
import { acceptRegistration, RegistrationError } from "@/lib/auth/registrationService";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid JSON body"), { status: 400 });
  }

  try {
    const user = await acceptRegistration(raw);
    return NextResponse.json(
      {
        id: user.id,
        loginIdentifier: user.loginIdentifier,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof RegistrationError) {
      if (err.code === "DISABLED") {
        return NextResponse.json(buildErrorBody("forbidden", "Registration is disabled"), {
          status: 403,
        });
      }
      if (err.code === "DUPLICATE") {
        // Generic conflict; must not reveal whether the account already exists.
        return NextResponse.json(buildErrorBody("conflict", "Account already exists"), {
          status: 409,
        });
      }
      return NextResponse.json(buildErrorBody("bad_request", err.message), { status: 400 });
    }
    return NextResponse.json(buildErrorBody("internal_server_error", "Registration failed"), {
      status: 500,
    });
  }
}
