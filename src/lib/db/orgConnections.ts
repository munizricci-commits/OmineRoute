/**
 * db/orgConnections.ts — Organization-scoped provider connection CRUD (P4.02/03/04).
 *
 * Additive org-layer over the existing `providers.ts` connection engine. It does
 * NOT fork `providers.ts` core logic: creates reuse `createProviderConnection`
 * (which owns dedup + encryption), updates reuse `updateProviderConnection`
 * (which merges and preserves credentials), and deletes reuse
 * `deleteProviderConnection`. This module only *scopes* those rows by
 * `organization_id` and enforces the org authorization policy at the DB boundary.
 *
 * Authorization is FAIL-CLOSED: a mutation with no manager context (or a
 * non-manager context) is rejected. Read helpers accept an optional `actorCtx`;
 * when supplied, a non-member context is rejected.
 *
 * @module lib/db/orgConnections
 */

import { getDbInstance, rowToCamel, cleanNulls } from "./core";
import { decryptConnectionFields } from "./encryption";
import {
  withNullableMaxConcurrent,
  withNullableQuotaWindowThresholds,
  withNullableRateLimitOverrides,
} from "./providers/columns";
import {
  createProviderConnection,
  updateProviderConnection,
  deleteProviderConnection,
} from "./providers";
import { getOrganizationById } from "./organizations";
import {
  canManageOrganizationResource,
  canReadOrganization,
  resolveConnectionVisibility,
  redactConnectionCredentials,
} from "@/lib/org/authorization";
import type { OrganizationContext } from "@/lib/org/types";

type JsonRecord = Record<string, unknown>;

interface DbLike {
  prepare: <TRow = unknown>(
    sql: string
  ) => {
    all: (...params: unknown[]) => TRow[];
    get: (...params: unknown[]) => TRow | undefined;
    run: (...params: unknown[]) => { changes?: number };
  };
  transaction: <T>(fn: () => T) => () => T;
  exec: (sql: string) => void;
}

/** Errors surfaced by the org-connection service. Sanitized before client use. */
export class OrgConnectionError extends Error {
  constructor(
    message: string,
    public readonly code:
      "ORG_NOT_FOUND" | "CONNECTION_NOT_FOUND" | "NOT_AUTHORIZED" | "ALREADY_IN_ORG"
  ) {
    super(message);
    this.name = "OrgConnectionError";
  }
}

/**
 * Map a raw provider_connections row into a decrypted, normalized connection
 * object — mirrors `getProviderConnectionById`'s projection so org-scoped reads
 * are byte-compatible with the legacy personal read path.
 */
function toOrgConnection(row: Record<string, unknown>): JsonRecord {
  const camelRow = rowToCamel(row) as JsonRecord;
  return decryptConnectionFields(
    withNullableRateLimitOverrides(
      withNullableQuotaWindowThresholds(
        withNullableMaxConcurrent(cleanNulls(camelRow), camelRow),
        camelRow
      ),
      camelRow
    )
  ) as JsonRecord;
}

function rawOrgConnections(orgId: string): JsonRecord[] {
  const db = getDbInstance() as unknown as DbLike;
  const rows = db
    .prepare(
      "SELECT * FROM provider_connections WHERE organization_id = ? ORDER BY priority ASC, updated_at DESC"
    )
    .all(orgId) as Record<string, unknown>[];
  return rows.map(toOrgConnection);
}

/**
 * Create a provider connection owned by an organization.
 *
 * Authorization: `actorCtx` must be an owner/moderator of `orgId` (fail-closed).
 * The connection is created via the shared `createProviderConnection` engine and
 * then stamped with `organization_id` — credentials are never re-written.
 */
export async function createOrganizationConnection(
  orgId: string,
  data: JsonRecord,
  actorCtx: OrganizationContext | null
): Promise<JsonRecord> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgConnectionError(
      "Only an owner or moderator may create organization connections",
      "NOT_AUTHORIZED"
    );
  }
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new OrgConnectionError(`Organization '${orgId}' not found`, "ORG_NOT_FOUND");
  }

  const conn = (await createProviderConnection(data)) as JsonRecord;
  const db = getDbInstance() as unknown as DbLike;
  db.prepare("UPDATE provider_connections SET organization_id = ? WHERE id = ?").run(
    orgId,
    conn.id
  );
  return (await getOrganizationConnectionById(orgId, conn.id)) as JsonRecord;
}

/** List all connections owned by an organization (org-scoped; never personal). */
export async function getOrganizationConnections(
  orgId: string,
  actorCtx?: OrganizationContext | null
): Promise<JsonRecord[]> {
  if (actorCtx && !canReadOrganization(actorCtx)) {
    throw new OrgConnectionError(
      "Only an organization member may read its connections",
      "NOT_AUTHORIZED"
    );
  }
  return rawOrgConnections(orgId);
}

/**
 * Fetch a single organization connection by id, scoped to `orgId`. Returns null
 * when the connection does not exist OR belongs to a different organization
 * (so callers cannot probe cross-org existence).
 */
export async function getOrganizationConnectionById(
  orgId: string,
  id: string,
  actorCtx?: OrganizationContext | null
): Promise<JsonRecord | null> {
  if (actorCtx && !canReadOrganization(actorCtx)) {
    throw new OrgConnectionError(
      "Only an organization member may read its connections",
      "NOT_AUTHORIZED"
    );
  }
  const db = getDbInstance() as unknown as DbLike;
  const row = db
    .prepare("SELECT * FROM provider_connections WHERE id = ? AND organization_id = ?")
    .get(id, orgId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return toOrgConnection(row);
}

/**
 * Update an organization connection. Authorization: owner/moderator of the org.
 * Reuses `updateProviderConnection`, which merges and preserves credentials — the
 * `organization_id` of the row is never touched.
 */
export async function updateOrganizationConnection(
  orgId: string,
  id: string,
  data: JsonRecord,
  actorCtx: OrganizationContext | null
): Promise<JsonRecord | null> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgConnectionError(
      "Only an owner or moderator may update organization connections",
      "NOT_AUTHORIZED"
    );
  }
  const existing = await getOrganizationConnectionById(orgId, id);
  if (!existing) return null;

  await updateProviderConnection(id, data);
  // Re-read scoped to the org; updateProviderConnection never changes organization_id.
  return (await getOrganizationConnectionById(orgId, id)) as JsonRecord | null;
}

/**
 * Delete an organization connection. Authorization: owner/moderator of the org.
 * Reuses `deleteProviderConnection` (which also cleans up dependent state).
 */
export async function deleteOrganizationConnection(
  orgId: string,
  id: string,
  actorCtx: OrganizationContext | null
): Promise<boolean> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgConnectionError(
      "Only an owner or moderator may delete organization connections",
      "NOT_AUTHORIZED"
    );
  }
  const existing = await getOrganizationConnectionById(orgId, id);
  if (!existing) return false;
  await deleteProviderConnection(id);
  return true;
}
