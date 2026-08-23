/**
 * POST /api/auth/resend-verification
 *
 * Re-issues an email-verification token for an account that is not yet verified.
 * Always returns a generic 200 so the response is identical whether or not a
 * matching unverified account exists (anti-enumeration). Mail delivery failures
 * are swallowed (the same generic 200 is returned).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserByEmail } from "@/lib/db/users";
import { createEmailVerificationToken } from "@/lib/db/emailVerification";
import { sendEmailVerificationEmail } from "@/lib/auth/emailVerificationService";
import { isSmtpConfigured } from "@/lib/db/smtpConfig";
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
  const user = await getUserByEmail(email);
  // Generic success regardless of outcome (anti-enumeration).
  const generic = NextResponse.json({
    message: "If an unverified account exists for that address, a verification link has been sent.",
  });

  if (user && user.emailVerified === false) {
    const smtpOn = await isSmtpConfigured();
    if (smtpOn) {
      try {
        const token = await createEmailVerificationToken(user.id, user.email ?? email);
        await sendEmailVerificationEmail(user.id, user.email ?? email, token);
      } catch {
        // Swallow mail failures; still return the generic message.
      }
    }
  }

  return generic;
}
