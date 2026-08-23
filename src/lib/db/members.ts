/**
 * db/members.ts — Organization membership service (P2.03).
 *
 * Owns the `organization_members` table and enforces the membership RBAC rules:
 *  - only an owner or moderator may add/remove members;
 *  - only an owner may promote a member to moderator or remove a moderator;
 *  - the owner membership is immutable: an owner can never be removed, and the
 *    org can never be left without an owner (last-owner protection);
 *  - at most one owner per org (owner is set only at create time / via transfer).
 *
 * Authorization is enforced here (the DB module is the source of truth, not the
 * route layer) so these invariants hold no matter which caller invokes them.
 * Callers that surface errors to clients must translate `MembershipError` via
 * the sanitized error helpers — these are not leaked raw.
 *
 * @module lib/db/members
 */

import { v4 as uuidv4 } from "uuid";
import { getDbInstance, rowToCamel, resetDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";
import { getOrganizationById, parseMemberRow, type OrgRole } from "./organizations";
import { getUserById } from "./users";

export type { OrgRole } from "./organizations";

export interface MembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: string; // active (default)
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddMemberInput {
  organizationId: string;
  userId: string;
  /** Role to grant. Defaults to "user". Only an owner may grant "moderator". */
  role?: OrgRole;
  invitedBy?: string | null;
  /** The member performing the action — must be owner or moderator. */
  actorUserId: string;
}

export class MembershipError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ORG_NOT_FOUND"
      | "MEMBER_NOT_FOUND"
      | "USER_NOT_FOUND"
      | "NOT_AUTHORIZED"
      | "OWNER_CANNOT_BE_REMOVED"
      | "LAST_OWNER_PROTECTION"
      | "ROLE_INVALID"
      | "ALREADY_MEMBER"
  ) {
    super(message);
    this.name = "MembershipError";
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

/** Active membership lookup (the unit of authorization). */
async function getActiveMembership(
  orgId: string,
  userId: string
): Promise<MembershipRecord | null> {
  if (!orgId || !userId) return null;
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
    )
    .get(orgId, userId) as Record<string, unknown> | undefined;
  return row ? parseMemberRow(row) : null;
}

/**
 * Add a member to an organization.
 *
 * Authorization: actor must be owner or moderator. A moderator may only add
 * role="user"; granting "moderator" requires an owner actor. Adding a second
 * owner is forbidden. The target user must exist. Idempotent under the
 * (organization_id, user_id) UNIQUE constraint — a concurrent re-add returns
 * the existing active membership rather than a second row.
 */
export async function addMember(input: AddMemberInput): Promise<MembershipRecord> {
  const org = await getOrganizationById(input.organizationId);
  if (!org) {
    throw new MembershipError(
      `Cannot add member: organization '${input.organizationId}' not found`,
      "ORG_NOT_FOUND"
    );
  }

  const actor = await getActiveMembership(input.organizationId, input.actorUserId);
  if (!actor || (actor.role !== "owner" && actor.role !== "moderator")) {
    throw new MembershipError("Only an owner or moderator may add members", "NOT_AUTHORIZED");
  }

  const role = clampRole(input.role ?? "user");
  if (role === "owner") {
    throw new MembershipError(
      "A second owner cannot be added directly; use owner transfer",
      "ROLE_INVALID"
    );
  }
  if (role === "moderator" && actor.role !== "owner") {
    throw new MembershipError("Only an owner may add a moderator", "NOT_AUTHORIZED");
  }

  const user = await getUserById(input.userId);
  if (!user) {
    throw new MembershipError(
      `Cannot add member: user '${input.userId}' does not exist`,
      "USER_NOT_FOUND"
    );
  }

  // Idempotent: return the existing active membership if present (UNIQUE-safe).
  const existing = await getActiveMembership(input.organizationId, input.userId);
  if (existing) return existing;

  const db = getDbInstance();
  const id = uuidv4();
  const ts = nowIso();
  const invitedBy = input.invitedBy === undefined ? null : input.invitedBy;

  try {
    await db
      .prepare(
        `INSERT INTO organization_members
           (id, organization_id, user_id, role, status, invited_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(id, input.organizationId, input.userId, role, invitedBy, ts, ts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/.test(message)) {
      const again = await getActiveMembership(input.organizationId, input.userId);
      if (again) return again;
    }
    throw err;
  }

  const row = db.prepare(`SELECT * FROM organization_members WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return parseMemberRow(row);
}

/**
 * Remove a member. Hard-deletes the active membership row.
 *
 * Rules: actor must be owner or moderator; a moderator may not remove a
 * moderator (owner only); the owner can never be removed; the org can never be
 * left without an owner (last-owner protection).
 */
export async function removeMember(
  organizationId: string,
  userId: string,
  actorUserId: string
): Promise<boolean> {
  const org = await getOrganizationById(organizationId);
  if (!org) {
    throw new MembershipError(
      `Cannot remove member: organization '${organizationId}' not found`,
      "ORG_NOT_FOUND"
    );
  }

  const actor = await getActiveMembership(organizationId, actorUserId);
  if (!actor || (actor.role !== "owner" && actor.role !== "moderator")) {
    throw new MembershipError("Only an owner or moderator may remove members", "NOT_AUTHORIZED");
  }

  const target = await getActiveMembership(organizationId, userId);
  if (!target) {
    throw new MembershipError(
      `Cannot remove member: user '${userId}' is not an active member`,
      "MEMBER_NOT_FOUND"
    );
  }

  if (target.role === "owner") {
    throw new MembershipError("The owner cannot be removed", "OWNER_CANNOT_BE_REMOVED");
  }
  if (target.role === "moderator" && actor.role !== "owner") {
    throw new MembershipError("Only an owner may remove a moderator", "NOT_AUTHORIZED");
  }

  // Defensive last-owner protection (owner removal is already blocked above).
  if (target.role === "owner") {
    const db = getDbInstance();
    const owners = db
      .prepare(
        `SELECT COUNT(*) AS c FROM organization_members WHERE organization_id = ? AND role = 'owner' AND status = 'active'`
      )
      .get(organizationId) as { c: number };
    if (owners.c <= 1) {
      throw new MembershipError(
        "Cannot remove the last owner of the organization",
        "LAST_OWNER_PROTECTION"
      );
    }
  }

  const db = getDbInstance();
  const res = db
    .prepare(`DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?`)
    .run(organizationId, userId);
  return res.changes > 0;
}

/**
 * Promote a member to moderator (user -> moderator). Only an owner may promote.
 */
export async function promoteMember(
  organizationId: string,
  userId: string,
  actorUserId: string
): Promise<MembershipRecord> {
  const actor = await requireActorOwner(organizationId, actorUserId);

  const target = await getActiveMembership(organizationId, userId);
  if (!target) {
    throw new MembershipError(
      `Cannot promote: user '${userId}' is not an active member`,
      "MEMBER_NOT_FOUND"
    );
  }
  if (target.role === "owner") {
    throw new MembershipError("The owner is already at the highest role", "ROLE_INVALID");
  }
  if (target.role === "moderator") {
    return target; // already a moderator — idempotent no-op
  }

  return setRole(organizationId, userId, "moderator");
}

/**
 * Demote a moderator to a regular user (moderator -> user). Only an owner may demote.
 */
export async function demoteMember(
  organizationId: string,
  userId: string,
  actorUserId: string
): Promise<MembershipRecord> {
  const actor = await requireActorOwner(organizationId, actorUserId);

  const target = await getActiveMembership(organizationId, userId);
  if (!target) {
    throw new MembershipError(
      `Cannot demote: user '${userId}' is not an active member`,
      "MEMBER_NOT_FOUND"
    );
  }
  if (target.role === "owner") {
    throw new MembershipError("The owner cannot be demoted", "ROLE_INVALID");
  }
  if (target.role === "user") {
    return target; // already a user — idempotent no-op
  }

  return setRole(organizationId, userId, "user");
}

/**
 * List active members of an organization, ordered by role precedence then
 * creation time. Pass `includeInactive: true` to also return removed members.
 */
export async function listMembers(
  organizationId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<MembershipRecord[]> {
  const db = getDbInstance();
  const base = `SELECT * FROM organization_members WHERE organization_id = ?`;
  const statusClause = opts.includeInactive ? "" : ` AND status = 'active'`;
  const rows = db
    .prepare(
      `${base}${statusClause}
       ORDER BY
         CASE role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
         created_at ASC`
    )
    .all(organizationId) as Record<string, unknown>[];
  return rows.map(parseMemberRow);
}

/**
 * Get a single membership. Defaults to active only; pass
 * `{ includeInactive: true }` to fetch a removed membership.
 */
export async function getMembership(
  organizationId: string,
  userId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<MembershipRecord | null> {
  if (!organizationId || !userId) return null;
  const db = getDbInstance();
  const row = opts.includeInactive
    ? (db
        .prepare(
          `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`
        )
        .get(organizationId, userId) as Record<string, unknown> | undefined)
    : (db
        .prepare(
          `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
        )
        .get(organizationId, userId) as Record<string, unknown> | undefined);
  return row ? parseMemberRow(row) : null;
}

/**
 * List all (active) organization memberships for a user across organizations.
 * Used by the admin user-detail view (Task 03). Returns safe membership rows only.
 */
export async function getUserMemberships(userId: string): Promise<MembershipRecord[]> {
  if (!userId) return [];
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT * FROM organization_members WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map(parseMemberRow);
}

async function requireActorOwner(
  organizationId: string,
  actorUserId: string
): Promise<MembershipRecord> {
  const org = await getOrganizationById(organizationId);
  if (!org) {
    throw new MembershipError(`Organization '${organizationId}' not found`, "ORG_NOT_FOUND");
  }
  const actor = await getActiveMembership(organizationId, actorUserId);
  if (!actor || actor.role !== "owner") {
    throw new MembershipError("Only an owner may perform this action", "NOT_AUTHORIZED");
  }
  return actor;
}

async function setRole(
  organizationId: string,
  userId: string,
  role: OrgRole
): Promise<MembershipRecord> {
  const db = getDbInstance();
  const ts = nowIso();
  await db
    .prepare(
      `UPDATE organization_members SET role = ?, updated_at = ? WHERE organization_id = ? AND user_id = ? AND status = 'active'`
    )
    .run(role, ts, organizationId, userId);
  const row = db
    .prepare(
      `SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
    )
    .get(organizationId, userId) as Record<string, unknown>;
  return parseMemberRow(row);
}

// ── Test state reset ─────────────────────────────────────────────────────────
let _membersStateResetRegistered = false;
function resetMembersState() {
  // Table is torn down by resetDbInstance(); nothing in-memory to drop.
}
if (typeof registerDbStateResetter === "function" && !_membersStateResetRegistered) {
  try {
    registerDbStateResetter(resetMembersState);
    _membersStateResetRegistered = true;
  } catch {
    // best-effort
  }
}

export { resetDbInstance };
