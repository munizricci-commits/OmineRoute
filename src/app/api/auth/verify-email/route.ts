/**
 * POST /api/auth/verify-email
 *
 * Consumes an email-verification token and marks the account verified. Fail-closed:
 * an unknown, expired, or already-used token yields a generic 400 without
 * disclosing whether the account exists (anti-enumeration).
 */

import { NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/db/emailVerification";
import { getUserById, setUserEmailVerified } from "@/lib/db/users";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { z } from "zod";

const schema = z.object({
  token: z.string().trim().min(1).max(512),
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

  const meta = await consumeEmailVerificationToken(parsed.data.token);
  if (!meta) {
    // Unknown / expired / already-used. Generic, no account disclosure.
    return NextResponse.json(
      buildErrorBody("bad_request", "Invalid or expired verification link"),
      { status: 400 }
    );
  }

  const user = await getUserById(meta.userId);
  if (!user) {
    return NextResponse.json(
      buildErrorBody("bad_request", "Invalid or expired verification link"),
      { status: 400 }
    );
  }

  await setUserEmailVerified(user.id, true);
  return NextResponse.json({ success: true, verified: true });
}
