/**
 * org/comboScope.ts — Org-scoping invariants for combos (P5.02).
 *
 * Enforces Invariant #8: an org-combo may ONLY reference org-scoped connections
 * belonging to the SAME organization. A NULL-org (personal) combo may reference
 * any connection — this preserves legacy personal-combo behavior unchanged
 * (Invariant #1).
 *
 * The validation reuses the existing org-connection read path
 * (`getOrganizationConnectionById`) as the single source of truth for "does this
 * connection belong to that org" — no forking, no raw SQL. A connection that is
 * personal (organization_id IS NULL) or belongs to a different org returns null
 * from that helper, which is exactly the rejection condition here.
 *
 * @module lib/org/comboScope
 */

import type { ComboRecord } from "@/domain/persistence/comboRepositories";
import { getOrganizationConnectionById } from "@/lib/db/orgConnections";

/** Errors surfaced by combo scope validation. Sanitized before client use. */
export class ComboScopeError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_TARGET" | "ORG_NOT_FOUND"
  ) {
    super(message);
    this.name = "ComboScopeError";
  }
}

type JsonRecord = Record<string, unknown>;
type ComboStep = Record<string, unknown>;

/**
 * Collect every connection id referenced by a combo. Combo connection targets
 * live inside the `models` array: each step carries a `connectionId` and may
 * carry an `allowedConnectionIds` fan-out list. Returns a de-duplicated list of
 * string ids (empty entries skipped).
 */
export function extractComboConnectionIds(combo: ComboRecord | JsonRecord): string[] {
  const ids = new Set<string>();
  const models = (combo as JsonRecord).models;
  if (!Array.isArray(models)) return [];

  for (const raw of models) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as ComboStep;

    if (typeof step.connectionId === "string" && step.connectionId.length > 0) {
      ids.add(step.connectionId);
    }
    if (Array.isArray(step.allowedConnectionIds)) {
      for (const id of step.allowedConnectionIds) {
        if (typeof id === "string" && id.length > 0) ids.add(id);
      }
    }
  }

  return [...ids];
}

/**
 * Validate that a combo only references connections the caller's organization
 * is allowed to use.
 *
 *  - `organizationId` is NULL/undefined → personal combo; any connection is
 *    permitted (legacy behavior). Returns without throwing.
 *  - `organizationId` is set → org-combo; EVERY referenced connection must
 *    belong to that organization. Any reference to a personal connection or a
 *    connection of a different org throws `ComboScopeError` (INVALID_TARGET).
 *
 * Authorization of *who* may call this is the caller's responsibility (P5.03).
 */
export async function validateComboTargets(
  combo: ComboRecord | JsonRecord,
  organizationId: string | null | undefined
): Promise<void> {
  if (organizationId == null) return; // personal combo — any connection allowed

  const targetIds = extractComboConnectionIds(combo);
  for (const connectionId of targetIds) {
    // Returns null for personal connections and for connections of other orgs.
    const conn = await getOrganizationConnectionById(organizationId, connectionId);
    if (!conn) {
      throw new ComboScopeError(
        `Combo references connection '${connectionId}' which is not a member of organization '${organizationId}'`,
        "INVALID_TARGET"
      );
    }
  }
}
