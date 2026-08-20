/**
 * auth/passwordRecoveryService.ts — dispatch of password-reset emails (Phase 06, Task 03).
 *
 * Renders the versioned reset template and dispatches it through the EmailService.
 * SMTP may be unconfigured (noop transport) or unreachable; failures are swallowed
 * so the recovery flow never surfaces mail-system errors to the caller (which would
 * be an account-enumeration / information-leak vector). The caller (forgot-password
 * endpoint) already returns a generic 200 regardless.
 */

import { EmailService } from "@/lib/email/service";
import { NoopEmailTransport } from "@/lib/email/noopTransport";
import { buildSmtpTransport } from "@/lib/email/smtpTransport";
import { renderPasswordResetEmail } from "@/lib/email/templates";

export interface ResetEmailResult {
  dispatched: boolean;
  message: string;
}

export async function sendPasswordResetEmail(
  _userId: string,
  email: string,
  token: string
): Promise<ResetEmailResult> {
  const link = `${resetBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const rendered = renderPasswordResetEmail({ link, login: email });

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
    // Never surface mail failures to the caller (anti-enumeration).
    return { dispatched: false, message: link };
  }
}

function resetBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:20128";
}
