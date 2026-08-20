/**
 * email/smtpTransport.ts — SMTP transport adapter (Phase 05, Task 06).
 *
 * Implements a minimal SMTP client over node:tls / node:net (no external
 * dependency) supporting STARTTLS + AUTH LOGIN. The password is decrypted only
 * inside the send boundary and is NEVER logged. Failures are observable: the
 * transport records a structured result (host/port/code) without secrets.
 */

import * as tls from "node:tls";
import { connect as netConnect, Socket } from "node:net";
import type { EmailMessage, EmailTransport, SendResult } from "./types";
import { getSmtpConfig } from "@/lib/db/smtpConfig";
import { decrypt } from "@/lib/db/encryption";

const SMTP_PORT_DEFAULT = 587;
const CONNECT_TIMEOUT_MS = 10000;
const SOCKET_TIMEOUT_MS = 10000;

export interface SmtpConnectionResult {
  ok: boolean;
  message: string;
  transport: "smtp";
  /** Present only on failure; never includes the password. */
  code?: string;
}

function base64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function smtpError(message: string, code?: string): SmtpConnectionResult {
  return { ok: false, message, transport: "smtp", code };
}

/** Validate config and (optionally) probe the TCP port. No credentials sent. */
export async function testSmtpConnection(probe = false): Promise<SmtpConnectionResult> {
  const cfg = await getSmtpConfig();
  if (!cfg.enabled) return smtpError("SMTP is disabled");
  if (!cfg.host || !cfg.port) return smtpError("SMTP host and port are required");

  if (probe) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = netConnect({ host: cfg.host!, port: cfg.port!, timeout: CONNECT_TIMEOUT_MS });
        const t = setTimeout(() => {
          sock.destroy();
          reject(new Error("connect timeout"));
        }, CONNECT_TIMEOUT_MS);
        sock.once("connect", () => {
          clearTimeout(t);
          sock.destroy();
          resolve();
        });
        sock.once("error", (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return smtpError(`Cannot reach SMTP server: ${msg}`);
    }
  }
  return {
    ok: true,
    message: `SMTP configuration valid (${cfg.host}:${cfg.port})`,
    transport: "smtp",
  };
}

interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string | null;
}

/**
 * A minimal SMTP client. Supports plain (25/587 with STARTTLS) and implicit TLS
 * (465). AUTH LOGIN only. Failures surface as SendResult with a code; the
 * password is used solely to build the AUTH command and is never logged.
 */
class SmtpNetTransport implements EmailTransport {
  readonly name = "smtp";
  private readonly opts: SmtpOptions;

  constructor(opts: SmtpOptions) {
    this.opts = opts;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      await this.deliver(message);
      return { ok: true, transport: this.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Observable failure, no secret in the message.
      console.error(`[SMTP] send failed to ${this.opts.host}:${this.opts.port} — ${msg}`);
      return { ok: false, transport: this.name, error: "SMTP send failed" };
    }
  }

  private async deliver(message: EmailMessage): Promise<void> {
    const { host, port, secure, user, password } = this.opts;
    const from = message.from || this.opts.from || `noreply@${host}`;
    const to = message.to;

    const socket = await this.connect(host, port, secure);
    try {
      await this.greet(socket);
      // STARTTLS on the standard submission port when not already implicit TLS.
      if (!secure) {
        await this.starttls(socket);
      }
      if (user && password) {
        await this.authLogin(socket, user, password);
      }
      await this.sendMail(socket, from, to, message);
      await this.quit(socket);
    } finally {
      socket.destroy();
    }
  }

  private connect(host: string, port: number, secure: boolean): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = (secure ? tls.connect : netConnect)(
        secure
          ? { host, port, timeout: SOCKET_TIMEOUT_MS }
          : { host, port, timeout: SOCKET_TIMEOUT_MS }
      ) as Socket;
      sock.setEncoding("utf8");
      sock.setTimeout(SOCKET_TIMEOUT_MS, () => sock.destroy(new Error("SMTP socket timeout")));
      sock.once("error", reject);
      sock.once("secureConnect", () => resolve(sock));
      sock.once("connect", () => resolve(sock));
    });
  }

  private async readReply(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      const onData = (data: string) => {
        const text = data.toString();
        const code = text.slice(0, 3);
        // Multi-line replies end with "code space".
        if (text.match(/^\d{3} /)) {
          socket.removeListener("data", onData);
          resolve(text);
        } else if (/^\d{3}-/.test(text)) {
          // continuation; wait for terminal line
        } else {
          socket.removeListener("data", onData);
          reject(new Error(`Unexpected SMTP reply: ${text}`));
        }
      };
      socket.once("data", onData);
    });
  }

  private write(socket: Socket, cmd: string): void {
    socket.write(`${cmd}\r\n`);
  }

  private async cmd(socket: Socket, command: string, expect = "2"): Promise<string> {
    this.write(socket, command);
    const reply = await this.readReply(socket);
    if (!reply.startsWith(expect)) {
      throw new Error(`SMTP ${command.split(" ")[0]} failed: ${reply.trim()}`);
    }
    return reply;
  }

  private async greet(socket: Socket): Promise<void> {
    const reply = await this.readReply(socket);
    if (!reply.startsWith("220")) throw new Error(`SMTP greeting failed: ${reply.trim()}`);
    await this.cmd(socket, `EHLO ${this.opts.host}`, "250");
  }

  private async starttls(socket: Socket): Promise<void> {
    const reply = await this.cmd(socket, "STARTTLS", "220");
    // Upgrade the existing socket to TLS in place.
    // (For the minimal client we re-wrap via tls; the socket is already a TCP
    // socket, so we perform STARTTLS by negotiating a new TLS layer.)
    await new Promise<void>((resolve, reject) => {
      const upgraded = tls.connect({ socket, host: this.opts.host }, () => resolve());
      upgraded.once("error", reject);
      // Replace the working socket reference for subsequent commands.
      Object.assign(socket, upgraded);
    });
    void reply;
    // Re-greet over the TLS layer.
    await this.cmd(socket, `EHLO ${this.opts.host}`, "250");
  }

  private async authLogin(socket: Socket, user: string, password: string): Promise<void> {
    await this.cmd(socket, "AUTH LOGIN", "334");
    await this.cmd(socket, base64(user), "334");
    await this.cmd(socket, base64(password), "235");
  }

  private async sendMail(
    socket: Socket,
    from: string,
    to: string,
    message: EmailMessage
  ): Promise<void> {
    await this.cmd(socket, `MAIL FROM:<${from}>`, "250");
    await this.cmd(socket, `RCPT TO:<${to}>`, "250");
    await this.cmd(socket, "DATA", "354");
    const body =
      `From: ${from}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${message.subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n\r\n` +
      (message.html ?? message.text) +
      `\r\n.\r\n`;
    await this.cmd(socket, body, "250");
  }

  private async quit(socket: Socket): Promise<void> {
    try {
      this.write(socket, "QUIT");
    } catch {
      /* best effort */
    }
  }
}

/**
 * Resolve a concrete EmailTransport for the configured SMTP server, or null when
 * SMTP is not configured (so the caller can fall back to noop). The password is
 * decrypted here, inside the transport boundary, and never returned.
 */
export async function buildSmtpTransport(): Promise<EmailTransport | null> {
  const cfg = await getSmtpConfig();
  if (!cfg.enabled || !cfg.host) return null;
  const db = (await import("@/lib/db/core.ts")).getDbInstance();
  const row = db.prepare(`SELECT password FROM smtp_config WHERE id = 'singleton'`).get() as
    { password: string | null } | undefined;
  const password = row?.password ? (decrypt(row.password) ?? null) : null;
  return new SmtpNetTransport({
    host: cfg.host,
    port: cfg.port ?? SMTP_PORT_DEFAULT,
    secure: cfg.secure,
    user: cfg.user ?? null,
    password,
    from: cfg.from ?? null,
  });
}
