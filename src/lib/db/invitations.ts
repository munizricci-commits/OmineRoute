/**
 * db/invitations.ts — Organization invitation lifecycle (P2.04).
 *
 * Owns the `organization_invitations` table. An invitation is a single-use,
 * token-bearing grant scoped to an email + role + organization. The token is
 * the replay boundary:
 *   - issued as `pending` with an `expires_at`;
 *   - `acceptInvitation(token)` claims it exactly once (status -> `accepted`)
 *     and materializes a membership; a second accept with the same token is a
 *     replay and is rejected WITHOUT creating a second membership;
 *   - `revoked` / `expired` tokens are rejected identically.
 *
 * Authorization: only an owner or moderator may issue or revoke invitations
 * (consistent with membership management in P2.03). The DB module enforces
 * this so the invariant holds regardless of caller.
 *
 * @module lib/db/invitations
 */

import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { getDbInstance, rowToCamel, resetDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";
import { getOrganizationById, parseMemberRow, type OrgRole } from "./organizations";
import { getUserById } from "./users";

export type { OrgRole } from "./organizations";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  token: string;
  status: InvitationStatus;
  expiresAt: string;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  /** Role to grant on accept. Defaults to "user". Only owner/moderator may invite. */
  role?: OrgRole;
  /** Actor issuing the invite — must be an owner or moderator of the org. */
  invitedBy: string;
  /** Override the default TTL (7 days). */
  expiresInMs?: number;
}

export interface MembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: string;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InvitationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ORG_NOT_FOUND"
      | "NOT_AUTHORIZED"
      | "ROLE_INVALID"
      | "INVITATION_NOT_FOUND"
      | "INVITATION_NOT_PENDING"
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampRole(value: unknown): OrgRole {
  return value === "owner" || value === "moderator" || value === "user"
    ? (value as OrgRole)
    : "user";
}

function parseInviteRow(row: Record<string, unknown>): InvitationRecord {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    organizationId: String(camel.organizationId),
    email: String(camel.email),
    role: clampRole(camel.role),
    token: String(camel.token),
    status:
      camel.status === "accepted" || camel.status === "revoked" || camel.status === "expired"
        ? (camel.status as InvitationStatus)
        : "pending",
    expiresAt: String(camel.expiresAt),
    invitedBy:
      camel.invitedBy === null || camel.invitedBy === undefined ? null : String(camel.invitedBy),
    createdAt: String(camel.createdAt),
    updatedAt: String(camel.updatedAt),
  };
}

// ── sync (in-transaction) helpers ────────────────────────────────────────────

function getInviteByTokenSync(token: string): InvitationRecord | null {
  if (!token) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM organization_invitations WHERE token = ?`).get(token) as
    Record<string, unknown> | undefined;
  return row ? parseInviteRow(row) : null;
}

function getActiveMembershipSync(orgId: string, userId: string): MembershipRecord | null {
  if (!orgId || !userId) return null;
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
    )
    .get(orgId, userId) as Record<string, unknown> | undefined;
  return row ? parseMemberRow(row) : null;
}

function requireActorManagerSync(orgId: string, actorUserId: string): boolean {
  const actor = getActiveMembershipSync(orgId, actorUserId);
  return !!actor && (actor.role === "owner" || actor.role === "moderator");
}

function generateUniqueToken(): string {
  const db = getDbInstance();
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomBytes(32).toString("hex");
    const existing = db
      .prepare(`SELECT 1 FROM organization_invitations WHERE token = ?`)
      .get(token);
    if (!existing) return token;
  }
  // Astonishingly unlikely; fall back to a UUID-suffixed token.
  return randomBytes(16).toString("hex") + uuidv4().replace(/-/g, "");
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Create a single-use invitation. Generates a unique token and an `expires_at`.
 * Only an owner or moderator may invite. A second owner cannot be invited.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<InvitationRecord> {
  const org = await getOrganizationById(input.organizationId);
  if (!org) {
    throw new InvitationError(
      `Cannot invite: organization '${input.organizationId}' not found`,
      "ORG_NOT_FOUND"
    );
  }
  if (!requireActorManagerSync(input.organizationId, input.invitedBy)) {
    throw new InvitationError("Only an owner or moderator may invite members", "NOT_AUTHORIZED");
  }

  const role = clampRole(input.role ?? "user");
  if (role === "owner") {
    throw new InvitationError("Cannot invite a second owner", "ROLE_INVALID");
  }

  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw new InvitationError("Invitation email is required", "ROLE_INVALID");
  }

  const db = getDbInstance();
  const id = uuidv4();
  const token = generateUniqueToken();
  const ts = nowIso();
  const ttl = input.expiresInMs && input.expiresInMs > 0 ? input.expiresInMs : DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();

  await db
    .prepare(
      `INSERT INTO organization_invitations
         (id, organization_id, email, role, token, status, expires_at, invited_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .run(id, input.organizationId, email, role, token, expiresAt, input.invitedBy, ts, ts);

  const row = db.prepare(`SELECT * FROM organization_invitations WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return parseInviteRow(row);
}

/**
 * Accept an invitation by token, materializing a membership for `userId`.
 *
 * Replay-protected: the token is claimed exactly once (status -> 'accepted').
 * Accepting an already-accepted / revoked / expired / unknown token returns
 * null and NEVER creates a second membership. An expired token is first marked
 * `expired` so listings stay accurate.
 */
export async function acceptInvitation(
  token: string,
  userId: string
): Promise<MembershipRecord | null> {
  const invite = getInviteByTokenSync(token);
  if (!invite) return null; // unknown or already-consumed token
  if (invite.status !== "pending") return null; // accepted/revoked/expired -> replay rejected

  const db = getDbInstance();
  const ts = nowIso();

  // Lazy expiry: past its time -> mark expired and reject.
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    db.prepare(
      `UPDATE organization_invitations SET status = 'expired', updated_at = ? WHERE token = ? AND status = 'pending'`
    ).run(ts, token);
    return null;
  }

  const user = await getUserById(userId);
  if (!user) return null; // accepting user must exist

  let membership: MembershipRecord | undefined;
  const claim = db.prepare(
    `UPDATE organization_invitations SET status = 'accepted', updated_at = ? WHERE token = ? AND status = 'pending'`
  );
  const insertMember = db.prepare(
    `INSERT INTO organization_members
       (id, organization_id, user_id, role, status, invited_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    // Atomic claim: if another accept already flipped the token, changes == 0.
    const res = claim.run(ts, token);
    if (res.changes === 0) return; // replay — token already consumed

    const existing = getActiveMembershipSync(invite.organizationId, userId);
    if (existing) {
      membership = existing; // idempotent: already a member, no second row
      return;
    }
    const mid = uuidv4();
    insertMember.run(mid, invite.organizationId, userId, invite.role, invite.invitedBy, ts, ts);
    const row = db.prepare(`SELECT * FROM organization_members WHERE id = ?`).get(mid) as Record<
      string,
      unknown
    >;
    membership = parseMemberRow(row);
  });
  tx();

  return typeof membership !== "undefined" ? membership : null;
}

/**
 * Revoke a pending invitation. Only an owner or moderator may revoke.
 * Returns true if a pending invitation was revoked.
 */
export async function revokeInvitation(token: string, actorUserId: string): Promise<boolean> {
  const invite = getInviteByTokenSync(token);
  if (!invite) {
    throw new InvitationError(`Cannot revoke: invitation token not found`, "INVITATION_NOT_FOUND");
  }
  if (!requireActorManagerSync(invite.organizationId, actorUserId)) {
    throw new InvitationError(
      "Only an owner or moderator may revoke invitations",
      "NOT_AUTHORIZED"
    );
  }

  const db = getDbInstance();
  const res = db
    .prepare(
      `UPDATE organization_invitations SET status = 'revoked', updated_at = ? WHERE token = ? AND status = 'pending'`
    )
    .run(nowIso(), token);
  return res.changes > 0;
}

/** List invitations for an organization, newest first. Filter by status. */
export async function listInvitations(
  organizationId: string,
  opts: { status?: InvitationStatus } = {}
): Promise<InvitationRecord[]> {
  const db = getDbInstance();
  const rows =
    opts.status === undefined
      ? (db
          .prepare(
            `SELECT * FROM organization_invitations WHERE organization_id = ? ORDER BY created_at DESC`
          )
          .all(organizationId) as Record<string, unknown>[])
      : (db
          .prepare(
            `SELECT * FROM organization_invitations WHERE organization_id = ? AND status = ? ORDER BY created_at DESC`
          )
          .all(organizationId, opts.status) as Record<string, unknown>[]);
  return rows.map(parseInviteRow);
}

/** Fetch an invitation by its token (public, async wrapper). */
export async function getInvitationByToken(token: string): Promise<InvitationRecord | null> {
  return getInviteByTokenSync(token);
}

// ── Test state reset ─────────────────────────────────────────────────────────
let _invitesStateResetRegistered = false;
function resetInvitesState() {
  // Table is torn down by resetDbInstance(); nothing in-memory to drop.
}
if (typeof registerDbStateResetter === "function" && !_invitesStateResetRegistered) {
  try {
    registerDbStateResetter(resetInvitesState);
    _invitesStateResetRegistered = true;
  } catch {
    // best-effort
  }
}

export { resetDbInstance };
