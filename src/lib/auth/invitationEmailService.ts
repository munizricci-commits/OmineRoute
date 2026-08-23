/**
 * auth/invitationEmailService.ts — dispatch of organization invitation emails (Phase 07, Task 04).
 *
 * Renders the versioned invitation template and dispatches it through the
 * EmailService. SMTP may be unconfigured (e.g. self-hosted local instance): when
 * no transport is available we fall back to a noop transport so invitation
 * creation never fails because of missing mail infra. Failures are returned as a
 * result, never thrown, so the API layer can stay resilient.
 */

import { EmailService } from "@/lib/email/service";
import { EmailMessage, SendResult } from "@/lib/email/types";
import { NoopEmailTransport } from "@/lib/email/noopTransport";
import { buildSmtpTransport } from "@/lib/email/smtpTransport";
import { renderInvitationEmail } from "@/lib/email/templates";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export interface SendInvitationInput {
  organizationName: string;
  email: string;
  token: string;
  invitedBy?: string | null;
  /** Base URL used to build the acceptance link. Falls back to a relative path. */
  appBaseUrl?: string;
}

export async function sendInvitationEmail(input: SendInvitationInput): Promise<SendResult> {
  if (!input.email || !input.token || !input.organizationName) {
    return { ok: false, error: "invalid_invitation_email_input" };
  }
  const base = (input.appBaseUrl ?? "").replace(/\/$/, "");
  const link = `${base}/accept-invitation?token=${encodeURIComponent(input.token)}`;

  const rendered = renderInvitationEmail({
    link,
    orgName: input.organizationName,
    inviter: input.invitedBy ?? null,
  });

  const message: EmailMessage = {
    to: input.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };

  const transport = (await buildSmtpTransport()) ?? new NoopEmailTransport();
  const svc = new EmailService({ transport });
  try {
    return await svc.send(message);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invitation_send_failed" };
  }
}
