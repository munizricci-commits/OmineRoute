/**
 * db/externalIdentities.ts — external identity links for OAuth login
 * (Phase 08, Tasks 04 + 06).
 *
 * Maps a provider-scoped external account (e.g. github:12345) to a local user.
 * The UNIQUE(provider, sub) constraint guarantees one external identity links
 * to exactly one local user (prevents account takeover / link confusion).
 * Additive; no FK coupling back into legacy tables.
 *
 * @module lib/db/externalIdentities
 */

import { v4 as uuidv4 } from "uuid";
import { getDbInstance, rowToCamel } from "./core";

export type OAuthProviderId = "github";

export interface ExternalIdentity {
  id: string;
  provider: OAuthProviderId;
  sub: string;
  userId: string;
  email: string | null;
  createdAt: string;
}

export interface LinkExternalIdentityInput {
  provider: OAuthProviderId;
  sub: string;
  userId: string;
  email?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRow(row: Record<string, unknown>): ExternalIdentity {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    provider: camel.provider as OAuthProviderId,
    sub: String(camel.sub),
    userId: String(camel.userId),
    email: camel.email === null || camel.email === undefined ? null : String(camel.email),
    createdAt: String(camel.createdAt),
  };
}

/**
 * Link an external identity to a local user. Throws on UNIQUE(provider,sub)
 * violation (the external id is already linked to another user).
 */
export async function linkExternalIdentity(
  input: LinkExternalIdentityInput
): Promise<ExternalIdentity> {
  const db = getDbInstance();
  const id = uuidv4();
  const ts = nowIso();
  const email = input.email === undefined ? null : input.email;
  db.prepare(
    `INSERT INTO external_identities (id, provider, sub, user_id, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.provider, input.sub, input.userId, email, ts);
  const row = db.prepare(`SELECT * FROM external_identities WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return parseRow(row);
}

/** Find the local user for a provider-scoped external id, or null. */
export async function findUserByExternalId(
  provider: OAuthProviderId,
  sub: string
): Promise<ExternalIdentity | null> {
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT * FROM external_identities WHERE provider = ? AND sub = ?`)
    .get(provider, sub) as Record<string, unknown> | undefined;
  return row ? parseRow(row) : null;
}

/** List all external identities linked to a local user. */
export async function getExternalIdentitiesForUser(userId: string): Promise<ExternalIdentity[]> {
  const db = getDbInstance();
  const rows = db
    .prepare(`SELECT * FROM external_identities WHERE user_id = ?`)
    .all(userId) as Record<string, unknown>[];
  return rows.map(parseRow);
}
