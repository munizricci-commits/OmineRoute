"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchCombos, fetchConnections } from "../apiClient";
import type { OrganizationCombo, OrganizationConnection } from "../types";

interface CatalogEntry {
  qualifiedRoute: string;
  name: string;
  kind: "combo" | "connection";
}

/**
 * Org model catalog (P8.06). Lists the org's combos and connections and flags
 * each as org-scoped with an "org" badge + qualified-route prefix, so they are
 * visually distinct from personal (un-badged) entries elsewhere in the catalog.
 * Read-only display.
 */
export default function OrgModelCatalog({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [combos, connections]: [OrganizationCombo[], OrganizationConnection[]] =
        await Promise.all([fetchCombos(orgId), fetchConnections(orgId)]);
      const list: CatalogEntry[] = [
        ...combos.map((c) => ({
          qualifiedRoute: c.qualifiedRoute,
          name: c.name,
          kind: "combo" as const,
        })),
        ...connections.map((c) => ({
          qualifiedRoute: c.qualifiedRoute,
          name: (c.name as string) ?? (c.provider as string) ?? c.id,
          kind: "connection" as const,
        })),
      ];
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
      <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-main)]">
        Model catalog
        <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
          org-scoped entries are flagged with an “org” badge
        </span>
      </div>
      {loading ? (
        <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
          No org-scoped models in this catalog.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map((e) => (
            <li
              key={e.qualifiedRoute}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div>
                <div className="text-sm font-mono text-[var(--color-text-main)]">
                  {e.qualifiedRoute}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">{e.kind}</div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full border bg-violet-500/15 text-violet-300 border-violet-500/30">
                org
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
