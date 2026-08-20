/**
 * email/types.ts — shared types for the email delivery abstraction (Phase 05).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional from override; the transport supplies a default when omitted. */
  from?: string;
}

export interface SendResult {
  ok: boolean;
  transport: string;
  /** Present only on failure; never contains secrets. */
  error?: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}
