/**
 * db/orgQuotas.ts — Organization-wide quota configuration (P9.02).
 *
 * Additive org-layer over the existing quota infrastructure. It does NOT fork
 * the quota_sharing engine: consumption/enforcement reuse the shared
 * `QuotaStore` (poolId = `org:<orgId>`) via `lib/org/orgQuotaEnforcement.ts`
 * (P9.03). This module ONLY owns the *configuration* row per organization.
 *
 * Authorization is FAIL-CLOSED: `setOrganizationQuota` rejects any actor who is
 * not an owner/moderator of the target organization (mirrors orgConnections.ts).
 * Read helpers are intentionally open to any caller because the API layer (P9.04)
 * already gates them behind the org membership check.
 *
 * @module lib/db/orgQuotas
 */

import { getDbInstance, rowToCamel } from "./core";
import { getOrganizationById } from "./organizations";
import { canManageOrganizationResource } from "@/lib/org/authorization";
import type { OrganizationContext } from "@/lib/org/types";
import type { QuotaUnit, QuotaWindow } from "@/lib/quota/dimensions";

/** Organization-wide quota configuration. `null` fields => unlimited/unset. */
export interface OrganizationQuotaConfig {
  organizationId: string;
  /** Cap on `scope` units within `window`. `null` => unlimited. */
  limit: number | null;
  /** Quota window (e.g. "hourly" | "daily"). `null` => unset. */
  window: QuotaWindow | null;
  /** Quota unit (e.g. "requests" | "tokens" | "usd"). `null` => unset. */
  scope: QuotaUnit | null;
  updatedAt: string;
}

export interface SetOrganizationQuotaInput {
  limit: number | null;
  window: QuotaWindow;
  scope: QuotaUnit;
}

/** Errors surfaced by the org-quota service. Sanitized before client use. */
export class OrgQuotaError extends Error {
  constructor(
    message: string,
    public readonly code: "ORG_NOT_FOUND" | "NOT_AUTHORIZED" | "INVALID_INPUT"
  ) {
    super(message);
    this.name = "OrgQuotaError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRow(row: Record<string, unknown> | undefined): OrganizationQuotaConfig | null {
  if (!row) return null;
  const camel = rowToCamel(row) as Record<string, unknown>;
  const limitRaw = camel.quotaLimit;
  const limit =
    limitRaw === null || limitRaw === undefined
      ? null
      : typeof limitRaw === "number"
        ? limitRaw
        : Number(limitRaw);
  return {
    organizationId: String(camel.organizationId),
    limit: Number.isFinite(limit as number) ? (limit as number) : null,
    window: (camel.window as QuotaWindow | null) ?? null,
    scope: (camel.scope as QuotaUnit | null) ?? null,
    updatedAt: String(camel.updatedAt),
  };
}

/** Read the organization quota config, or `null` when none is configured. */
export async function getOrganizationQuota(
  organizationId: string
): Promise<OrganizationQuotaConfig | null> {
  if (!organizationId) return null;
  const db = getDbInstance();
  const row = db
    .prepare(`SELECT * FROM organization_quotas WHERE organization_id = ?`)
    .get(organizationId) as Record<string, unknown> | undefined;
  return parseRow(row);
}

/**
 * Upsert the organization quota config. Authorization: *** of the org
 * (fail-closed). The organization must exist. A `null` limit means unlimited.
 */
export async function setOrganizationQuota(
  organizationId: string,
  input: SetOrganizationQuotaInput,
  actorCtx: OrganizationContext | null
): Promise<OrganizationQuotaConfig> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgQuotaError(
      "Only an owner or moderator may configure organization quota",
      "NOT_AUTHORIZED"
    );
  }
  if (!organizationId) {
    throw new OrgQuotaError("organizationId is required", "INVALID_INPUT");
  }
  if (input.limit !== null && !(typeof input.limit === "number" && input.limit >= 0)) {
    throw new OrgQuotaError("limit must be a non-negative number or null", "INVALID_INPUT");
  }

  const org = await getOrganizationById(organizationId);
  if (!org) {
    throw new OrgQuotaError(`Organization '${organizationId}' not found`, "ORG_NOT_FOUND");
  }

  const db = getDbInstance();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO organization_quotas (organization_id, quota_limit, window, scope, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(organization_id) DO UPDATE SET
       quota_limit = excluded.quota_limit,
       window = excluded.window,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  ).run(organizationId, input.limit, input.window, input.scope, ts);

  return (await getOrganizationQuota(organizationId))!;
}

/** Remove a configured organization quota (reset to unlimited). Manager only. */
export async function deleteOrganizationQuota(
  organizationId: string,
  actorCtx: OrganizationContext | null
): Promise<boolean> {
  if (!canManageOrganizationResource(actorCtx)) {
    throw new OrgQuotaError(
      "Only an owner or moderator may clear organization quota",
      "NOT_AUTHORIZED"
    );
  }
  if (!organizationId) return false;
  const db = getDbInstance();
  const res = db
    .prepare(`DELETE FROM organization_quotas WHERE organization_id = ?`)
    .run(organizationId);
  return (res.changes ?? 0) > 0;
}
