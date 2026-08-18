"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchCombos, fetchConnections } from "../apiClient";
import type { OrganizationCombo, OrganizationConnection } from "../types";

interface OrgModelOption {
  qualifiedRoute: string;
  kind: "combo" | "connection";
}

/**
 * Org-scoped model picker (P8.05). Given an org slug it surfaces the org's
 * combos and connections as qualified routes (e.g. `team1/combo:dev`,
 * `team1/auto:coding`). When no org is selected the component renders a
 * placeholder and leaves the personal picker untouched — a simple conditional
 * render keeps the two surfaces independent.
 */
export default function OrgModelPicker({
  orgId,
  orgSlug,
  value,
  onChange,
}: {
  orgId: string;
  orgSlug?: string;
  value?: string;
  onChange?: (route: string) => void;
}) {
  const [options, setOptions] = useState<OrgModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasOrg = Boolean(orgSlug);

  const load = useCallback(async () => {
    if (!hasOrg) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [combos, connections]: [OrganizationCombo[], OrganizationConnection[]] =
        await Promise.all([fetchCombos(orgId), fetchConnections(orgId)]);
      const opts: OrgModelOption[] = [
        ...combos.map((c) => ({
          qualifiedRoute: c.qualifiedRoute,
          kind: "combo" as const,
        })),
        ...connections.map((c) => ({
          qualifiedRoute: c.qualifiedRoute,
          kind: "connection" as const,
        })),
      ];
      setOptions(opts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load org models");
    } finally {
      setLoading(false);
    }
  }, [orgId, hasOrg]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasOrg) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-muted)]">
        Select an organization to see its org-scoped models. Your personal picker is unchanged.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--color-text-main)]">
        Org-scoped models ({orgSlug})
      </h2>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : options.length === 0 ? (
        <div className="text-sm text-[var(--color-text-muted)]">
          No org-scoped combos or connections.
        </div>
      ) : (
        <label className="block">
          <span className="text-xs text-[var(--color-text-muted)]">Qualified route</span>
          <select
            value={value ?? ""}
            onChange={(e) => onChange?.(e.target.value)}
            className="mt-1 w-full rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-main)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">— select —</option>
            {options.map((o) => (
              <option key={o.qualifiedRoute} value={o.qualifiedRoute}>
                {o.qualifiedRoute} ({o.kind})
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
