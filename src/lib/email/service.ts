/**
 * email/service.ts — the EmailService facade (Phase 05, Task 01).
 *
 * Thin, dependency-free orchestration over an EmailTransport. Validates the
 * message contract and delegates delivery. Knows nothing about SMTP (added in
 * later tasks); defaults to the noop transport so the system stays operable
 * before SMTP is configured.
 */

import type { EmailMessage, EmailTransport, SendResult } from "./types";
import { NoopEmailTransport } from "./noopTransport";

export class EmailService {
  private readonly transport: EmailTransport;

  constructor(opts: { transport?: EmailTransport } = {}) {
    this.transport = opts.transport ?? new NoopEmailTransport();
  }

  /** Validate the minimal message contract before handing off to a transport. */
  private validate(message: EmailMessage): void {
    if (!message || typeof message.to !== "string" || message.to.trim() === "") {
      throw new Error("Email message requires a non-empty 'to' recipient");
    }
    if (typeof message.subject !== "string" || message.subject.trim() === "") {
      throw new Error("Email message requires a non-empty 'subject'");
    }
    if (typeof message.text !== "string" || message.text.trim() === "") {
      throw new Error("Email message requires non-empty 'text' body");
    }
  }

  async send(message: EmailMessage): Promise<SendResult> {
    this.validate(message);
    return this.transport.send(message);
  }
}
