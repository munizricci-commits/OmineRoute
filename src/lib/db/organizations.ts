/**
 * db/organizations.ts — Organization entity + membership anchor (P2.01).
 *
 * Owns the `organizations` and `organization_members` tables. The owner
 * invariant (every org has exactly one `owner` membership row) is enforced by
 * creating the org and its owner membership inside a single transaction in
 * `createOrganization`.
 *
 * This module deliberately does NOT reach into the routing domain (connections,
 * combos) — those are scoped in later phases. It also does not touch legacy
 * personal config: a database with zero org rows behaves exactly as before.
 *
 * @module lib/db/organizations
 */

import { v4 as uuidv4 } from "uuid";
import { getDbInstance, rowToCamel, resetDbInstance } from "./core";
import { registerDbStateResetter } from "./stateReset";
import { getUserById } from "./users";

export type OrgRole = "owner" | "moderator" | "user";
export type OrgStatus = "active" | "archived";

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  status: OrgStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  /** URL-safe unique identifier. Uniqueness enforced at the DB layer. */
  slug: string;
  /** Must reference an existing `users` row — the org owner. */
  ownerUserId: string;
  /** Optional actor that triggered creation (for membership audit trail). */
  invitedBy?: string | null;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
}

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

export interface OrganizationWithMembers extends OrganizationRecord {
  members: MembershipRecord[];
}

/** Parse a raw `organization_members` row into the camelCase shape. */
export function parseMemberRow(row: Record<string, unknown>): MembershipRecord {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    organizationId: String(camel.organizationId),
    userId: String(camel.userId),
    role: clampRole(camel.role),
    status: typeof camel.status === "string" ? camel.status : "active",
    invitedBy:
      camel.invitedBy === null || camel.invitedBy === undefined ? null : String(camel.invitedBy),
    createdAt: String(camel.createdAt),
    updatedAt: String(camel.updatedAt),
  };
}

/**
 * Thrown by org operations when a precondition fails (bad owner, duplicate
 * slug, missing org). Callers (routes) translate this into a sanitized client
 * response — these are NOT raw DB errors leaked to the client.
 */
export class OrganizationError extends Error {
  constructor(
    message: string,
    public readonly code:
      "OWNER_NOT_FOUND" | "SLUG_EXISTS" | "ORG_NOT_FOUND" | "SLUG_EXISTS_ON_UPDATE"
  ) {
    super(message);
    this.name = "OrganizationError";
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

function parseOrgRow(row: Record<string, unknown>): OrganizationRecord {
  const camel = rowToCamel(row) as Record<string, unknown>;
  return {
    id: String(camel.id),
    slug: String(camel.slug),
    name: String(camel.name),
    ownerUserId: String(camel.ownerUserId),
    status: camel.status === "archived" ? "archived" : "active",
    createdAt: String(camel.createdAt),
    updatedAt: String(camel.updatedAt),
  };
}

function normalizeSlug(slug: string): string {
  return String(slug || "")
    .trim()
    .toLowerCase();
}

/**
 * Create an organization plus its `owner` membership in one transaction.
 *
 * The owner invariant is enforced here: `ownerUserId` must reference an existing
 * `users` row, otherwise `OrganizationError(OWNER_NOT_FOUND)` is thrown before
 * any write. Slug uniqueness is enforced by the DB; a collision is surfaced as
 * `OrganizationError(SLUG_EXISTS)`.
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<OrganizationRecord> {
  const owner = await getUserById(input.ownerUserId);
  if (!owner) {
    throw new OrganizationError(
      `Cannot create organization: owner user '${input.ownerUserId}' does not exist`,
      "OWNER_NOT_FOUND"
    );
  }

  const slug = normalizeSlug(input.slug);
  if (!slug) {
    throw new OrganizationError("Cannot create organization: slug is required", "SLUG_EXISTS");
  }

  const db = getDbInstance();
  const id = uuidv4();
  const ts = nowIso();
  const invitedBy = input.invitedBy === undefined ? null : input.invitedBy;

  const insertOrg = db.prepare(
    `INSERT INTO organizations (id, slug, name, owner_user_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  );
  const insertOwnerMember = db.prepare(
    `INSERT INTO organization_members
       (id, organization_id, user_id, role, status, invited_by, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    insertOrg.run(id, slug, input.name, input.ownerUserId, ts, ts);
    insertOwnerMember.run(uuidv4(), id, input.ownerUserId, invitedBy, ts, ts);
  });

  try {
    tx();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE.*organizations.*slug|unique.*slug/i.test(message) || /slug/.test(message)) {
      throw new OrganizationError(
        `Cannot create organization: slug '${slug}' is already taken`,
        "SLUG_EXISTS"
      );
    }
    throw err;
  }

  return (await getOrganizationById(id))!;
}

export async function getOrganizationById(id: string): Promise<OrganizationRecord | null> {
  if (!id) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;
  return row ? parseOrgRow(row) : null;
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM organizations WHERE slug = ?`).get(normalized) as
    Record<string, unknown> | undefined;
  return row ? parseOrgRow(row) : null;
}

/**
 * Read an organization together with its membership list (active members only,
 * ordered by role precedence then creation time). Returns null when the org does
 * not exist. Used by service-layer callers that need the full org picture.
 */
export async function getOrganizationWithMembers(
  id: string
): Promise<OrganizationWithMembers | null> {
  const org = await getOrganizationById(id);
  if (!org) return null;

  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT * FROM organization_members
       WHERE organization_id = ? AND status = 'active'
       ORDER BY
         CASE role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
         created_at ASC`
    )
    .all(id) as Record<string, unknown>[];

  return { ...org, members: rows.map(parseMemberRow) };
}

/**
 * List organizations, defaulting to active only. Pass `status: "all"` to include
 * archived orgs (used by admin/audit surfaces).
 */
export async function listOrganizations(
  opts: { status?: OrgStatus | "all" } = {}
): Promise<OrganizationRecord[]> {
  const db = getDbInstance();
  const status = opts.status ?? "active";
  const rows =
    status === "all"
      ? (db.prepare(`SELECT * FROM organizations ORDER BY created_at ASC`).all() as Record<
          string,
          unknown
        >[])
      : (db
          .prepare(`SELECT * FROM organizations WHERE status = ? ORDER BY created_at ASC`)
          .all(status) as Record<string, unknown>[]);
  return rows.map(parseOrgRow);
}

/**
 * List organizations a given user is an active member of (active orgs only),
 * each annotated with the member's role. Used by the dashboard surface (P8.02)
 * and the `/api/organizations` list endpoint. Counting on the membership table
 * keeps the query a single join instead of N+1 lookups.
 */
export async function listUserOrganizations(
  userId: string
): Promise<Array<OrganizationRecord & { role: OrgRole }>> {
  if (!userId) return [];
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT o.*, m.role AS member_role
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.created_at ASC`
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => {
    const base = parseOrgRow(r);
    return { ...base, role: clampRole(r.member_role) };
  });
}

export async function updateOrganization(
  id: string,
  input: UpdateOrganizationInput
): Promise<OrganizationRecord | null> {
  const existing = await getOrganizationById(id);
  if (!existing) return null;

  const db = getDbInstance();
  const name = input.name === undefined ? existing.name : input.name;
  const slug = input.slug === undefined ? existing.slug : normalizeSlug(input.slug);
  const ts = nowIso();

  try {
    await db
      .prepare(`UPDATE organizations SET name = ?, slug = ?, updated_at = ? WHERE id = ?`)
      .run(name, slug, ts, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE.*organizations.*slug|unique.*slug/i.test(message) || /slug/.test(message)) {
      throw new OrganizationError(
        `Cannot update organization: slug '${slug}' is already taken`,
        "SLUG_EXISTS_ON_UPDATE"
      );
    }
    throw err;
  }

  return (await getOrganizationById(id))!;
}

/** Soft-archive an organization (status -> 'archived'). Excluded from active listings. */
export async function archiveOrganization(id: string): Promise<OrganizationRecord | null> {
  const existing = await getOrganizationById(id);
  if (!existing) return null;
  const db = getDbInstance();
  const ts = nowIso();
  await db
    .prepare(`UPDATE organizations SET status = 'archived', updated_at = ? WHERE id = ?`)
    .run(ts, id);
  return (await getOrganizationById(id))!;
}

export async function deleteOrganization(id: string): Promise<boolean> {
  const existing = await getOrganizationById(id);
  if (!existing) return false;
  const db = getDbInstance();

  const deleteMembers = db.prepare(`DELETE FROM organization_members WHERE organization_id = ?`);
  const deleteInvitations = db.prepare(
    `DELETE FROM organization_invitations WHERE organization_id = ?`
  );
  const deleteOrg = db.prepare(`DELETE FROM organizations WHERE id = ?`);

  const tx = db.transaction(() => {
    deleteMembers.run(id);
    deleteInvitations.run(id);
    deleteOrg.run(id);
  });
  tx();

  return true;
}

// ── Test state reset ─────────────────────────────────────────────────────────
let _orgsStateResetRegistered = false;
function resetOrgsState() {
  // Table is torn down by resetDbInstance(); nothing in-memory to drop.
}
if (typeof registerDbStateResetter === "function" && !_orgsStateResetRegistered) {
  try {
    registerDbStateResetter(resetOrgsState);
    _orgsStateResetRegistered = true;
  } catch {
    // best-effort
  }
}

export { resetDbInstance };
