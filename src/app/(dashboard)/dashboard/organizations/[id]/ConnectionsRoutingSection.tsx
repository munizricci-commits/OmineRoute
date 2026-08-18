"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchCombos, fetchConnections } from "../apiClient";
import type { OrganizationCombo, OrganizationConnection } from "../types";

export default function ConnectionsRoutingSection({ orgId }: { orgId: string }) {
  const [connections, setConnections] = useState<OrganizationConnection[]>([]);
  const [combos, setCombos] = useState<OrganizationCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [conn, cmb] = await Promise.all([fetchConnections(orgId), fetchCombos(orgId)]);
      setConnections(conn);
      setCombos(cmb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load routing resources");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Connections */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
        <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-main)]">
          Connections
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : connections.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
            No organization connections.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="px-5 py-3 font-medium">Qualified route</th>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Visibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {connections.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3 font-mono text-xs text-[var(--color-text-main)]">
                    {c.qualifiedRoute}
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">
                    {c.provider ?? c.name ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        c.visibility === "full"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
                      }`}
                    >
                      {c.visibility}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Combos */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
        <div className="px-5 py-3 border-b border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-main)]">
          Combos
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : combos.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
            No organization combos.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="px-5 py-3 font-medium">Qualified route</th>
                <th className="px-5 py-3 font-medium">Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {combos.map((c, i) => (
                <tr key={c.id ?? `${c.name}-${i}`}>
                  <td className="px-5 py-3 font-mono text-xs text-[var(--color-text-main)]">
                    {c.qualifiedRoute}
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">{c.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
