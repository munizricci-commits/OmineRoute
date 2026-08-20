/**
 * email/smtpTransport.ts — SMTP transport adapter (Phase 05).
 *
 * Builds an EmailTransport from persisted SmtpConfig. The actual network send
 * (nodemailer) is wired in Task 06; here we provide the connection-test helper
 * used by the admin `/test` endpoint so it can validate configuration without
 * leaking secrets. The test never returns the password.
 */

import type { EmailMessage, EmailTransport, SendResult } from "./types";
import { getSmtpConfig } from "@/lib/db/smtpConfig";
import { decrypt } from "@/lib/db/encryption";

export interface SmtpConnectionResult {
  ok: boolean;
  /** Human-readable status; never includes the password. */
  message: string;
  transport: "smtp";
}

/** Validate that a usable SMTP configuration is present (no network yet). */
export async function testSmtpConnection(): Promise<SmtpConnectionResult> {
  const cfg = await getSmtpConfig();
  if (!cfg.enabled) {
    return { ok: false, message: "SMTP is disabled", transport: "smtp" };
  }
  if (!cfg.host || !cfg.port) {
    return { ok: false, message: "SMTP host and port are required", transport: "smtp" };
  }
  // Configuration is present and well-formed. Actual SMTP verify() lands in Task 06.
  return {
    ok: true,
    message: `SMTP configuration valid (${cfg.host}:${cfg.port})`,
    transport: "smtp",
  };
}

/**
 * Resolve a concrete EmailTransport for the configured SMTP server. Until the
 * real transport is wired (Task 06), this returns null when SMTP is not
 * configured so the EmailService falls back to noop.
 */
export async function buildSmtpTransport(): Promise<EmailTransport | null> {
  const cfg = await getSmtpConfig();
  if (!cfg.enabled || !cfg.host) return null;
  // The password is decrypted only at send time, inside the transport boundary.
  const password = cfg.password === undefined ? null : null; // password never read here
  void password;
  return new (class implements EmailTransport {
    readonly name = "smtp";
    async send(_message: EmailMessage): Promise<SendResult> {
      // Real delivery wired in Task 06.
      return { ok: false, transport: this.name, error: "SMTP send not yet wired" };
    }
  })();
}
