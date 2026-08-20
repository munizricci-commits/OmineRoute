/**
 * db/githubOAuthState.ts — CSRF state store for the GitHub OAuth login flow
 * (Phase 08, Task 03).
 *
 * The `state` parameter is an unguessable, single-use, expiring token bound to a
 * login attempt. It is generated at authorize time, persisted server-side, and
 * verified on callback to prevent CSRF / authorization-code injection. Expired
 * or unknown states fail closed (callback rejects them).
 */

import { randomBytes } from "node:crypto";
import { getDbInstance } from "./core";

const STATE_TTL_MS = 1000 * 60 * 10; // 10 minutes

export interface OAuthStateRecord {
  state: string;
  redirectUri: string;
  expiresAt: number;
  createdAt: number;
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export async function createOAuthState(redirectUri: string): Promise<string> {
  const state = generateOAuthState();
  const now = Date.now();
  const db = getDbInstance();
  db.prepare(
    `INSERT INTO github_oauth_states (state, redirect_uri, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(
    state,
    redirectUri,
    new Date(now + STATE_TTL_MS).toISOString(),
    new Date(now).toISOString()
  );
  return state;
}

/**
 * Consume a state token (single-use). Returns the record if valid + unexpired,
 * or null if unknown / already used / expired. The row is deleted on success so
 * the token cannot be replayed.
 */
export async function consumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
  if (!state || typeof state !== "string" || state.length < 16) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM github_oauth_states WHERE state = ?`).get(state) as
    { state: string; redirect_uri: string; expires_at: string; created_at: string } | undefined;
  if (!row) return null;
  // Single-use: delete immediately.
  db.prepare(`DELETE FROM github_oauth_states WHERE state = ?`).run(state);
  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= Date.now()) return null;
  return {
    state: row.state,
    redirectUri: row.redirect_uri,
    expiresAt,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Build the GitHub authorize URL with the required OAuth parameters. */
export function buildGithubAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scope ?? "read:user user:email",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
