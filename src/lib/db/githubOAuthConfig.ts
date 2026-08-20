/**
 * db/githubOAuthConfig.ts — persistence for GitHub OAuth login config (Phase 08, Task 02).
 *
 * Singleton-row table `github_oauth_config` (id=1). The client_secret is
 * encrypted at rest via src/lib/db/encryption.ts and is NEVER returned in
 * plaintext by getGithubOAuthConfig (the read path masks it). setGithubOAuthConfig
 * encrypts on write. This keeps the OAuth secret out of API responses and logs
 * by construction.
 */

import { getDbInstance } from "./core";
import { encrypt } from "./encryption";

export interface GithubOAuthConfigInput {
  enabled?: boolean;
  clientId?: string | null;
  /** Raw secret in; encrypted at rest. Omit to leave unchanged on update. */
  clientSecret?: string | null;
  redirectUri?: string | null;
}

export interface GithubOAuthConfig {
  enabled: boolean;
  clientId: string;
  /** Always undefined on the read path (never exposed). */
  clientSecret: undefined;
  redirectUri: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRow(row: Record<string, unknown> | undefined): GithubOAuthConfig {
  if (!row) {
    return {
      enabled: false,
      clientId: "",
      clientSecret: undefined,
      redirectUri: "",
      updatedAt: "",
    };
  }
  return {
    enabled: row.enabled === 1 || row.enabled === true,
    clientId: (row.client_id as string) ?? "",
    clientSecret: undefined,
    redirectUri: (row.redirect_uri as string) ?? "",
    updatedAt: (row.updated_at as string) ?? "",
  };
}

export async function getGithubOAuthConfig(): Promise<GithubOAuthConfig> {
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM github_oauth_config WHERE id = 1`).get() as
    Record<string, unknown> | undefined;
  return parseRow(row);
}

export async function setGithubOAuthConfig(
  input: GithubOAuthConfigInput
): Promise<GithubOAuthConfig> {
  const db = getDbInstance();
  const existing = db.prepare(`SELECT * FROM github_oauth_config WHERE id = 1`).get() as
    Record<string, unknown> | undefined;

  const enabled = input.enabled ?? (existing?.enabled === 1 || existing?.enabled === true);
  const clientId =
    input.clientId !== undefined ? input.clientId : ((existing?.client_id as string) ?? "");
  const redirectUri =
    input.redirectUri !== undefined
      ? input.redirectUri
      : ((existing?.redirect_uri as string) ?? "");

  // Secret handling: encrypt the new value when provided; keep the existing
  // encrypted blob when omitted (supports partial updates without re-entering it).
  let secret = existing?.client_secret_enc as string | null | undefined;
  if (input.clientSecret !== undefined) {
    secret = input.clientSecret ? encrypt(input.clientSecret) : "";
  }

  const ts = nowIso();
  db.prepare(
    `INSERT INTO github_oauth_config (id, client_id, client_secret_enc, redirect_uri, enabled, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       client_id = excluded.client_id,
       client_secret_enc = excluded.client_secret_enc,
       redirect_uri = excluded.redirect_uri,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`
  ).run(clientId, secret ?? "", redirectUri, enabled ? 1 : 0, ts);

  return await getGithubOAuthConfig();
}

export async function isGithubOAuthEnabled(): Promise<boolean> {
  const cfg = await getGithubOAuthConfig();
  return cfg.enabled && cfg.clientId.length > 0;
}
