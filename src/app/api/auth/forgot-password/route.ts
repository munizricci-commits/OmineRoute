/**
 * POST /api/auth/forgot-password
 *
 * Password-recovery entry point. Always returns 200 with a generic message so
 * the response is identical whether or not the email exists (anti-enumeration).
 * For real users a one-time reset token is created; the reset email is sent via
 * the configured transport (wired in Task 03). Never reveals account existence.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserByEmail } from "@/lib/db/users";
import { createPasswordResetToken } from "@/lib/db/passwordReset";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

const schema = z.object({
  email: z.string().trim().email().max(254),
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
    return NextResponse.json(buildErrorBody("bad_request", "Invalid email"), { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  // Look up the user; regardless of result we return the same generic success.
  const user = await getUserByEmail(email);
  if (user) {
    // Create a reset token (stored hashed) — the email send is wired in Task 03.
    await createPasswordResetToken(user.id);
  }

  // Always generic. No field/account-existence disclosure.
  return NextResponse.json(
    { message: "If an account exists for that address, a reset link has been sent." },
    { status: 200 }
  );
}
