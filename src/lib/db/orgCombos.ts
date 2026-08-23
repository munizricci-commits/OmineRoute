/**
 * db/orgCombos.ts — Organization-scoped combo CRUD (P5.03).
 *
 * Additive org-layer over the existing `combos.ts` engine. It does NOT fork
 * `combos.ts` core logic: creates reuse `createCombo` (which owns
 * normalization + invariant checks), reads reuse `getComboById` (which owns
 * row-to-record parsing), and updates/deletes reuse `updateCombo` /
 * `deleteCombo`. This module only *scopes* those rows by `organization_id` and
 * enforces the org authorization policy at the DB boundary.
 *
 * Authorization is FAIL-CLOSED: a mutation with no manager context (or a
 * non-manager context) is rejected. Read helpers accept an optional `actorCtx`;
 * when supplied, a non-member context is rejected. When `actorCtx` is omitted
 * the read is performed unscoped (internal use only — API callers MUST pass a
 * resolved member context via the P3.03 gate).
 *
 * @module lib/db/orgCombos
 */

import { getDbInstance } from "./core";
import { createCombo, getComboById, updateCombo, deleteCombo } from "./combos";
import { getOrganizationById } from "./organizations";
import { canManageOrganizationResource } from "@/lib/org/authorization";
import { validateComboTargets, ComboScopeError } from "@/lib/org/comboScope";
import type { ComboRecord } from "@/domain/persistence/comboRepositories";

type JsonRecord = Record<string, unknown>;

interface DbLike {
  prepare: <TRow = unknown>(
    sql: string
  ) => {
    all: (...params: unknown[]) => TRow[];
    get: (...params: unknown[]) => TRow | undefined;
    run: (...params: unknown[]) => { changes?: number };
  };
}

/** Errors surfaced by the org-combo service. Sanitized before client use. */
export class OrgComboError extends Error {
  constructor(
    message: string,
    public readonly code: "ORG_NOT_FOUND" | "COMBO_NOT_FOUND" | "NOT_AUTHORIZED" | "INVALID_TARGET"
  ) {
    super(message);
    this.name = "OrgComboError";
  }
}

function db(): DbLike {
  return getDbInstance() as unknown as DbLike;
}

/** Re-read a combo by id and stamp it with its org scope for the caller. */
async function readScoped(orgId: string, id: string): Promise<ComboRecord | null> {
  const combo = await getComboById(id);
  if (!combo) return null;
  return { ...combo, organizationId: orgId };
}

async function requireOrg(orgId: string): Promise<void> {
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new OrgComboError(`Organization '${orgId}' not found`, "ORG_NOT_FOUND");
  }
}

/**
 * Create a combo owned by an organization.
 *
 * Authorization: must be an owner/moderator of `orgId` (fail-closed). The combo
 * is created via the shared `createCombo` engine and then stamped with
 * `organization_id`. Targets are validated against the org before persistence —
 * an org-combo may only reference connections of the same organization.
 */
export async function createOrganizationCombo(
  orgId: string,
  data: ComboRecord,
  actorCtx: import("@/lib/org/types").OrganizationContext | null
): Promise<ComboRecord> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgComboError(
      "Only an owner or moderator may create organization combos",
      "NOT_AUTHORIZED"
    );
  }
  await requireOrg(orgId);

  // Strip any caller-supplied org scope; the column is authoritative.
  const { organizationId: _ignoredOrg, organization_id: _ignoredCol, ...rest } = data as JsonRecord;
  const payload = rest as ComboRecord;

  // Validate targets BEFORE writing (Invariant #8).
  try {
    await validateComboTargets(payload, orgId);
  } catch (err) {
    if (err instanceof ComboScopeError) {
      throw new OrgComboError(err.message, "INVALID_TARGET");
    }
    throw err;
  }

  const combo = await createCombo(payload);
  db().prepare("UPDATE combos SET organization_id = ? WHERE id = ?").run(orgId, combo.id);

  return { ...combo, organizationId: orgId };
}

/**
 * List all combos owned by an organization (org-scoped; never personal).
 *
 * Membership is enforced by the caller (the P3.03 API gate resolves the org
 * context and rejects non-members before this is reached), so this helper is
 * deliberately unscoped with respect to the *caller* — it only scopes the
 * *result* to `orgId`.
 */
export async function getOrganizationCombos(orgId: string): Promise<ComboRecord[]> {
  const rows = db()
    .prepare(
      "SELECT id FROM combos WHERE organization_id = ? ORDER BY sort_order ASC, name COLLATE NOCASE ASC"
    )
    .all(orgId) as { id: string }[];
  const out: ComboRecord[] = [];
  for (const row of rows) {
    const combo = await readScoped(orgId, row.id);
    if (combo) out.push(combo);
  }
  return out;
}

/**
 * Fetch a single organization combo by id, scoped to `orgId`. Returns null when
 * the combo does not exist OR belongs to a different organization (so callers
 * cannot probe cross-org existence).
 */
export async function getOrganizationComboById(
  orgId: string,
  id: string
): Promise<ComboRecord | null> {
  const row = db().prepare("SELECT organization_id FROM combos WHERE id = ?").get(id) as
    { organization_id: string | null } | undefined;
  if (!row) return null;
  if (row.organization_id !== orgId) return null; // fail-closed: no existence reveal
  return readScoped(orgId, id);
}

/** Fetch a single personal (NULL-org) combo by name. Returns null otherwise. */
export async function getPersonalComboByName(name: string): Promise<ComboRecord | null> {
  const row = db()
    .prepare("SELECT id FROM combos WHERE name = ? AND organization_id IS NULL")
    .get(name) as { id: string } | undefined;
  if (!row) return null;
  const combo = await getComboById(row.id);
  if (!combo) return null;
  return combo;
}

export interface ComboScope {
  /** When set, the name is qualified and resolves within this organization. */
  organizationId?: string | null;
  name: string;
}

/**
 * Resolve a combo name within the caller's scope (P5.04).
 *
 *  - bare name (`organizationId` unset) → a personal combo
 *    (organization_id IS NULL). Legacy behavior, unchanged.
 *  - qualified scope (`organizationId` set) → that org's combo, but ONLY when
 *    `ctx` is a member of that organization. Fail-closed: a null context or a
 *    context for a *different* org yields `null` (no existence reveal).
 *
 * Note: an org combo is never returned for a bare name, even by the org's own
 * members — bare names are personal-only (Invariant #1).
 */
export async function resolveComboInScope(
  scope: ComboScope,
  ctx: import("@/lib/org/types").OrganizationContext | null
): Promise<ComboRecord | null> {
  if (scope.organizationId) {
    // Fail-closed: the caller must be an active member of the requested org.
    if (!ctx || ctx.organizationId !== scope.organizationId) return null;
    return getOrganizationComboByName(scope.organizationId, scope.name);
  }
  // Bare name → personal combo only.
  return getPersonalComboByName(scope.name);
}

/** Fetch a single organization combo by name, scoped to `orgId`. */
export async function getOrganizationComboByName(
  orgId: string,
  name: string
): Promise<ComboRecord | null> {
  const row = db()
    .prepare("SELECT id FROM combos WHERE organization_id = ? AND name = ?")
    .get(orgId, name) as { id: string } | undefined;
  if (!row) return null;
  return readScoped(orgId, row.id);
}

/**
 * Update an organization combo. Authorization: manager of the org. The combo
 * must belong to `orgId` (fail-closed); targets are re-validated against the
 * org on every update. Reuses `updateCombo`, which preserves invariants.
 */
export async function updateOrganizationCombo(
  orgId: string,
  id: string,
  data: ComboRecord,
  actorCtx: import("@/lib/org/types").OrganizationContext | null
): Promise<ComboRecord | null> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgComboError(
      "Only an owner or moderator may update organization combos",
      "NOT_AUTHORIZED"
    );
  }
  const existing = await getOrganizationComboById(orgId, id);
  if (!existing) return null;

  // Strip any caller-supplied org scope override.
  const { organizationId: _ignoredOrg, organization_id: _ignoredCol, ...rest } = data as JsonRecord;
  const payload = rest as ComboRecord;

  // Re-validate targets against the org (Invariant #8).
  try {
    await validateComboTargets(payload, orgId);
  } catch (err) {
    if (err instanceof ComboScopeError) {
      throw new OrgComboError(err.message, "INVALID_TARGET");
    }
    throw err;
  }

  const updated = await updateCombo(id, payload);
  if (!updated) return null;
  return { ...updated, organizationId: orgId };
}

/**
 * Delete an organization combo. Authorization: manager of the org. The combo
 * must belong to `orgId` (fail-closed). Reuses `deleteCombo`.
 */
export async function deleteOrganizationCombo(
  orgId: string,
  id: string,
  actorCtx: import("@/lib/org/types").OrganizationContext | null
): Promise<boolean> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgComboError(
      "Only an owner or moderator may delete organization combos",
      "NOT_AUTHORIZED"
    );
  }
  const existing = await getOrganizationComboById(orgId, id);
  if (!existing) return false;
  return deleteCombo(id);
}
