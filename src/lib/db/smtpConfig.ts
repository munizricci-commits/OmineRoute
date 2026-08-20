/**
 * db/smtpConfig.ts — persistence for SMTP configuration (Phase 05, Task 02).
 *
 * Singleton-row table `smtp_config`. The password is encrypted at rest via
 * src/lib/db/encryption.ts and is NEVER returned in plaintext by getSmtpConfig
 * (the read path masks it). setSmtpConfig encrypts on write. This keeps secrets
 * out of API responses and logs by construction.
 */

import { getDbInstance } from "./core";
import { encrypt, decrypt } from "./encryption";

const SINGLETON_ID = "singleton";

export interface SmtpConfigInput {
  enabled?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  user?: string | null;
  /** Raw password in; encrypted at rest. Omit to leave unchanged on update. */
  password?: string | null;
  from?: string | null;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  /** Always undefined on the read path (never exposed). */
  password: undefined;
  from: string | null;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRow(row: Record<string, unknown> | undefined): SmtpConfig {
  if (!row) {
    return {
      enabled: false,
      host: null,
      port: null,
      secure: false,
      user: null,
      password: undefined,
      from: null,
      updatedAt: "",
    };
  }
  return {
    enabled: row.enabled === 1 || row.enabled === true,
    host: (row.host as string | null) ?? null,
    port: row.port == null ? null : Number(row.port),
    secure: row.secure === 1 || row.secure === true,
    user: (row.user as string | null) ?? null,
    password: undefined,
    from: (row.from_address as string | null) ?? null,
    updatedAt: (row.updated_at as string) ?? "",
  };
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM smtp_config WHERE id = ?`).get(SINGLETON_ID) as
    Record<string, unknown> | undefined;
  return parseRow(row);
}

export async function setSmtpConfig(input: SmtpConfigInput): Promise<SmtpConfig> {
  const db = getDbInstance();
  const existing = db.prepare(`SELECT * FROM smtp_config WHERE id = ?`).get(SINGLETON_ID) as
    Record<string, unknown> | undefined;

  const enabled = input.enabled ?? (existing?.enabled === 1 || existing?.enabled === true);
  const host = input.host !== undefined ? input.host : ((existing?.host as string | null) ?? null);
  const port =
    input.port !== undefined ? input.port : existing?.port == null ? null : Number(existing.port);
  const secure =
    input.secure !== undefined ? input.secure : existing?.secure === 1 || existing?.secure === true;
  const user = input.user !== undefined ? input.user : ((existing?.user as string | null) ?? null);
  const from =
    input.from !== undefined ? input.from : ((existing?.from_address as string | null) ?? null);

  // Password handling: encrypt the new value when provided; keep the existing
  // encrypted blob when omitted (supports partial updates without re-entering it).
  let password = existing?.password as string | null | undefined;
  if (input.password !== undefined) {
    password = input.password ? encrypt(input.password) : null;
  }

  const ts = nowIso();
  db.prepare(
    `INSERT INTO smtp_config (id, enabled, host, port, secure, user, password, from_address, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       host = excluded.host,
       port = excluded.port,
       secure = excluded.secure,
       user = excluded.user,
       password = excluded.password,
       from_address = excluded.from_address,
       updated_at = excluded.updated_at`
  ).run(SINGLETON_ID, enabled ? 1 : 0, host, port, secure ? 1 : 0, user, password, from, ts);

  return await getSmtpConfig();
}
