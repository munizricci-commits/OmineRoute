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
  getProviderConnectionById,
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

/**
 * Transfer a provider connection's organization ownership.
 *
 * Directions:
 *  - personal (NULL org) -> org: the actor must be an owner/moderator of the
 *    TARGET org. (Connection-owner check omitted — see deviation below.)
 *  - org -> personal (reverse): the actor must be the OWNER of the SOURCE org
 *    (or a platform_admin override). Connection-owner check is omitted because
 *    `provider_connections` carries no per-user owner column in this
 *    single-tenant schema — documented in REPORTS.md.
 *  - org -> org: a single OrganizationContext cannot represent membership in two
 *    orgs, so this is restricted to a platform_admin override (fail-closed).
 *
 * Idempotent: transferring a connection that is already in `orgId` is a clean
 * no-op (returns the connection unchanged). Credentials are NEVER rewritten —
 * only `organization_id` (and `updated_at`) are updated.
 */
export async function transferConnectionToOrganization(
  connectionId: string,
  orgId: string | null,
  actorCtx: OrganizationContext | null
): Promise<JsonRecord> {
  if (!actorCtx) {
    throw new OrgConnectionError(
      "Authentication required to transfer a connection",
      "NOT_AUTHORIZED"
    );
  }

  const db = getDbInstance() as unknown as DbLike;
  const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(connectionId) as
    Record<string, unknown> | undefined;
  if (!row) {
    throw new OrgConnectionError(`Connection '${connectionId}' not found`, "CONNECTION_NOT_FOUND");
  }
  const currentOrg = (row.organization_id as string | null) ?? null;

  // Idempotent no-op: already in the target org (or already personal when null).
  if (currentOrg === orgId) {
    return toOrgConnection(row);
  }

  // Validate the target org exists when moving into an org.
  if (orgId !== null) {
    const org = await getOrganizationById(orgId);
    if (!org) {
      throw new OrgConnectionError(`Organization '${orgId}' not found`, "ORG_NOT_FOUND");
    }
  }

  const isPersonal = currentOrg === null;

  if (orgId === null) {
    // Reverse: org -> personal. Owner of the source org (or platform_admin).
    const isSourceOwner =
      actorCtx.organizationId === currentOrg &&
      (actorCtx.role === "owner" || actorCtx.platformAdminOverride === true);
    if (!isSourceOwner) {
      throw new OrgConnectionError(
        "Only the source organization owner may move a connection back to personal",
        "NOT_AUTHORIZED"
      );
    }
  } else if (isPersonal) {
    // Personal -> org: manager of the TARGET org.
    if (actorCtx.organizationId !== orgId || !canManageOrganizationResource(actorCtx)) {
      throw new OrgConnectionError(
        "Only an owner or moderator of the target organization may claim a personal connection",
        "NOT_AUTHORIZED"
      );
    }
  } else {
    // Org -> org: requires platform_admin override (single-context limitation).
    if (!actorCtx.platformAdminOverride) {
      throw new OrgConnectionError(
        "Cross-organization transfer requires platform admin override",
        "NOT_AUTHORIZED"
      );
    }
  }

  db.transaction(() => {
    db.prepare(
      "UPDATE provider_connections SET organization_id = ?, updated_at = ? WHERE id = ?"
    ).run(orgId, new Date().toISOString(), connectionId);
  })();

  if (orgId === null) {
    return (await getProviderConnectionById(connectionId)) as JsonRecord;
  }
  return (await getOrganizationConnectionById(orgId, connectionId)) as JsonRecord;
}
