/**
 * #7819 (Level 2) — per-API-key candidate exclusions for `auto/*` channels.
 *
 * Pure, dependency-light filter kept separate from `virtualFactory.ts` so it
 * is unit-testable in isolation, mirroring `paidModelFilter.ts` in this same
 * directory (`filterPaidOnlyCandidates`). Fail-open by design: an empty
 * exclusion set is the identity function (near-zero overhead on the
 * unconfigured hot path), and any caller-side lookup failure should pass the
 * candidate pool through unfiltered rather than break routing.
 */

interface OverridableCandidate {
  connectionId: string | null;
  allowedConnectionIds?: string[];
}

/**
 * Return the candidate pool with excluded connection IDs removed. Returns
 * the SAME array reference (identity) when there is nothing to filter, so
 * callers can cheaply detect "unchanged" the same way
 * `filterPaidOnlyCandidates` does.
 */
export function filterExcludedCandidates<T extends OverridableCandidate>(
  pool: T[],
  excludedConnectionIds: Set<string>
): T[] {
  if (!excludedConnectionIds || excludedConnectionIds.size === 0) return pool;

  return pool.flatMap((candidate) => {
    if (Array.isArray(candidate.allowedConnectionIds)) {
      const allowedConnectionIds = candidate.allowedConnectionIds.filter(
        (connectionId) => !excludedConnectionIds.has(connectionId)
      );
      if (allowedConnectionIds.length === 0) return [];
      if (allowedConnectionIds.length === candidate.allowedConnectionIds.length) {
        return [candidate];
      }
      return [{ ...candidate, allowedConnectionIds }];
    }

    return candidate.connectionId && excludedConnectionIds.has(candidate.connectionId)
      ? []
      : [candidate];
  });
}

/**
 * P7.02 (Organizations) — ALLOWLIST counterpart of `filterExcludedCandidates`.
 *
 * Restrict the candidate pool to a scoped set of connection ids so an
 * org-qualified auto route can only ever select the organization's own
 * connections. `null` means "unrestricted" (personal scope) and returns the SAME
 * array reference, keeping the personal hot path allocation-free and
 * byte-identical to pre-P7 behavior.
 *
 * FAIL-CLOSED, unlike the exclusion filter above: an EMPTY set allows nothing,
 * and a candidate with no resolvable connection identity is dropped under any
 * restricted scope. A denied/empty org scope must never widen back to the
 * personal pool.
 */
export function filterCandidatesByAllowedConnections<T extends OverridableCandidate>(
  pool: T[],
  allowedConnectionIds: Set<string> | null | undefined
): T[] {
  if (allowedConnectionIds === null || allowedConnectionIds === undefined) return pool;

  return pool.flatMap((candidate) => {
    if (Array.isArray(candidate.allowedConnectionIds)) {
      const allowed = candidate.allowedConnectionIds.filter((connectionId) =>
        allowedConnectionIds.has(connectionId)
      );
      if (allowed.length === 0) return [];
      if (allowed.length === candidate.allowedConnectionIds.length) return [candidate];
      return [{ ...candidate, allowedConnectionIds: allowed }];
    }

    return candidate.connectionId && allowedConnectionIds.has(candidate.connectionId)
      ? [candidate]
      : [];
  });
}
