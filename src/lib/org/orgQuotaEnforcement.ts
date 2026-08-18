/**
 * orgQuotaEnforcement.ts — Organization-scoped quota enforcement (P9.03).
 *
 * Reuses the EXISTING Quota Sharing Engine store (`getQuotaStore()`) keyed by a
 * per-organization pool id `org:<orgId>`. This is ADDITIVE (Invariant #1): the
 * personal/legacy quota path is never touched. Enforcement is resolved from the
 * routing scope (P6/P7) so changing the user/key cannot bypass the org quota.
 *
 * Fail behavior (B16): any store/lookup error is treated as "allow" so a
 * transient quota-infra failure never blocks legitimate traffic. A missing org
 * quota config = unlimited = allow.
 *
 * @module lib/org/orgQuotaEnforcement
 */

import { getOrganizationQuota } from "@/lib/db/orgQuotas";
import { getQuotaStore } from "@/lib/quota/QuotaStore";
import type { DimensionKey } from "@/lib/quota/dimensions";
import type { QuotaUnit } from "@/lib/quota/dimensions";
import type { RoutingScope } from "@/lib/org/autoScope";

export const ORG_QUOTA_POOL_PREFIX = "org:";

/** Stable pool id for an organization's quota in the shared QuotaStore. */
export function orgQuotaPoolId(organizationId: string): string {
  return `${ORG_QUOTA_POOL_PREFIX}${organizationId}`;
}

export type OrgQuotaDecision =
  { kind: "allow" } | { kind: "block"; reason: "org_quota_exceeded"; retryAfterSeconds?: number };

export interface EnforceOrgQuotaInput {
  /** Resolved routing scope (P6/P7). Non-organization => legacy path. */
  scope: RoutingScope;
  /** Organization id when scope === "organization". */
  organizationId: string | null;
  /** Quota unit being consumed. */
  unit: QuotaUnit;
  /** Estimated cost of this request (defaults to 1). */
  estimatedAmount?: number;
  /**
   * Optional usage lookup override (test seam). When omitted, the shared
   * QuotaStore pool `org:<orgId>` is queried.
   */
  getUsage?: (poolId: string, unit: QuotaUnit) => Promise<number>;
}

/**
 * PRE-request org-quota gate.
 * - personal / denied scope => allow (legacy personal quota unchanged).
 * - organization scope with no config => allow (unlimited).
 * - organization scope with a config => block when used + estimated > limit.
 * Cross-tenant isolated by `org:<orgId>` poolId.
 */
export async function enforceOrgQuotaScope(input: EnforceOrgQuotaInput): Promise<OrgQuotaDecision> {
  if (input.scope !== "organization" || !input.organizationId) {
    return { kind: "allow" };
  }
  const orgId = input.organizationId;

  let cfg;
  try {
    cfg = await getOrganizationQuota(orgId);
  } catch {
    return { kind: "allow" };
  }
  if (!cfg || cfg.limit == null) return { kind: "allow" };

  const amount = input.estimatedAmount ?? 1;
  const unit = input.unit;
  const poolId = orgQuotaPoolId(orgId);

  let used = 0;
  try {
    if (input.getUsage) {
      used = await input.getUsage(poolId, unit);
    } else {
      const store = getQuotaStore();
      used = await store.poolConsumedTotal(poolId, unit as DimensionKey);
    }
  } catch {
    return { kind: "allow" };
  }

  if (used + amount > cfg.limit) {
    return { kind: "block", reason: "org_quota_exceeded", retryAfterSeconds: 60 };
  }
  return { kind: "allow" };
}
