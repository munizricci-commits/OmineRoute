/**
 * db/invitations.ts — Organization invitation lifecycle (Phase 07, Tasks 01+02).
 *
 * Invitations are deliberately SEPARATE from authentication identity: an
 * invitation records "org X invites email E to join as role R", it is not an
 * account. Acceptance links an (already existing or about-to-be-created) user to
 * the org via organization_members, but never mints credentials.
 *
 * State machine: pending -> accepted | revoked | expired (expired is computed
 * lazily on read/consume; we never store 'expired' explicitly to keep the
 * single source of truth as expires_at).
 */

import { randomBytes } from "node:crypto";
import { getDbInstance } from "./core";

export const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  token: string;
  status: InvitationStatus;
  expiresAt: number;
  invitedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role?: string;
  invitedBy?: string | null;
  token?: string;
  expiresAtMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function parseInvitationRow(row: {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expires_at: string;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}): InvitationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status as InvitationStatus,
    expiresAt: new Date(row.expires_at).getTime(),
    invitedBy: row.invited_by,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function createInvitation(input: CreateInvitationInput): Promise<InvitationRecord> {
  const id = genId("inv");
  const token = input.token ?? randomBytes(32).toString("hex");
  const email = input.email.trim().toLowerCase();
  const role = input.role ?? "user";
  const expiresAt = new Date(input.expiresAtMs ?? nowMs() + INVITATION_TTL_MS).toISOString();
  const ts = nowIso();
  const db = getDbInstance();
  db.prepare(
    `INSERT INTO organization_invitations
       (id, organization_id, email, role, token, status, expires_at, invited_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(id, input.organizationId, email, role, token, expiresAt, input.invitedBy ?? null, ts, ts);
  const row = db
    .prepare(`SELECT * FROM organization_invitations WHERE id = ?`)
    .get(id) as Parameters<typeof parseInvitationRow>[0];
  return parseInvitationRow(row);
}

/** Read invitation metadata by token; returns null if unknown or revoked/expired-as-stored. */
export async function getInvitationByToken(token: string): Promise<InvitationRecord | null> {
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM organization_invitations WHERE token = ?`).get(token) as
    Parameters<typeof parseInvitationRow>[0] | undefined;
  if (!row) return null;
  return parseInvitationRow(row);
}

/** True if the invitation is currently consumable (pending + not expired). */
export async function isInvitationConsumable(token: string): Promise<boolean> {
  const meta = await getInvitationByToken(token);
  if (!meta) return false;
  if (meta.status !== "pending") return false;
  if (meta.expiresAt <= nowMs()) return false;
  return true;
}

/** List all invitations for an organization (pending + historical), newest first. */
export async function getInvitationsByOrganization(
  organizationId: string
): Promise<InvitationRecord[]> {
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT * FROM organization_invitations WHERE organization_id = ? ORDER BY created_at DESC`
    )
    .all(organizationId) as Parameters<typeof parseInvitationRow>[0][];
  return rows.map(parseInvitationRow);
}

export async function revokeInvitation(token: string): Promise<boolean> {
  const db = getDbInstance();
  const res = db
    .prepare(
      `UPDATE organization_invitations SET status = 'revoked', updated_at = ? WHERE token = ? AND status = 'pending'`
    )
    .run(nowIso(), token);
  return res.changes > 0;
}

/**
 * Atomically verify + mark accepted (consume). Returns the record on success, or
 * null if unknown / already used / revoked / expired. Does NOT create the user or
 * the membership row — callers wire membership creation (Task 05) separately.
 */
export async function acceptInvitation(
  token: string,
  userId: string
): Promise<InvitationRecord | null> {
  const db = getDbInstance();
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM organization_invitations WHERE token = ?`).get(token) as
      Parameters<typeof parseInvitationRow>[0] | undefined;
    if (!row) return null;
    if (row.status !== "pending") return null;
    if (new Date(row.expires_at).getTime() <= nowMs()) return null;
    db.prepare(
      `UPDATE organization_invitations SET status = 'accepted', updated_at = ? WHERE token = ?`
    ).run(nowIso(), token);
    return { ...parseInvitationRow(row), status: "accepted", updatedAt: nowMs() };
  });
  return tx();
}

/** Alias used by acceptance/consumption callers. */
export async function consumeInvitation(token: string): Promise<InvitationRecord | null> {
  // Consuming an invitation requires a user to bind to; accept with a placeholder
  // would be wrong, so consume == is-consumable check + return meta without state
  // change. State change (accepted) happens in acceptInvitation once a user exists.
  const meta = await getInvitationByToken(token);
  if (!meta) return null;
  if (meta.status !== "pending") return null;
  if (meta.expiresAt <= nowMs()) return null;
  return meta;
}

export class InvitationError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "ALREADY_ACCEPTED" | "REVOKED" | "EXPIRED" | "FORBIDDEN"
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

/** List all invitations for an organization (alias; see getInvitationsByOrganization). */
export async function listInvitations(organizationId: string): Promise<InvitationRecord[]> {
  return getInvitationsByOrganization(organizationId);
}
