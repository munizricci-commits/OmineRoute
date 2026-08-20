/**
 * email/noopTransport.ts — a no-op transport used as the safe default.
 *
 * Never contacts a network and never persists messages. Lets the rest of the
 * system call the email service unconditionally (invitations, verification,
 * password reset) while SMTP is unconfigured. Fail-closed by design: it reports
 * success without delivering, so callers cannot accidentally hard-fail on an
 * unconfigured instance.
 */

import type { EmailMessage, EmailTransport, SendResult } from "./types";

export class NoopEmailTransport implements EmailTransport {
  readonly name = "noop";

  async send(_message: EmailMessage): Promise<SendResult> {
    return { ok: true, transport: this.name };
  }
}
