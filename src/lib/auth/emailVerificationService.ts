/**
 * auth/emailVerificationService.ts — dispatch of email-verification emails (P4).
 *
 * Renders the verification template and dispatches it through the EmailService.
 * SMTP may be unconfigured (noop transport) or unreachable; failures are
 * swallowed so the registration/verification flow never surfaces mail-system
 * errors to the caller (which would be an information-leak vector). The caller
 * already returns a generic response regardless.
 *
 * @module lib/auth/emailVerificationService
 */

import { EmailService } from "@/lib/email/service";
import { NoopEmailTransport } from "@/lib/email/noopTransport";
import { buildSmtpTransport } from "@/lib/email/smtpTransport";
import { renderVerificationEmail } from "@/lib/email/templates";

export interface VerificationEmailResult {
  dispatched: boolean;
  message: string;
}

export async function sendEmailVerificationEmail(
  _userId: string,
  email: string,
  token: string
): Promise<VerificationEmailResult> {
  const link = `${verificationBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const rendered = renderVerificationEmail({ link, displayName: null });

  const transport = (await buildSmtpTransport()) ?? new NoopEmailTransport();
  const svc = new EmailService({ transport });
  try {
    const res = await svc.send({
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { dispatched: res.ok, message: link };
  } catch {
    // Never surface mail failures to the caller (anti-enumeration / resilience).
    return { dispatched: false, message: link };
  }
}

function verificationBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:20128";
}
