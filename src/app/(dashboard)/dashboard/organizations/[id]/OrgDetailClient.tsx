"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchOrganization } from "../apiClient";
import type { OrgRole, OrganizationDetail } from "../types";
import RoleBadge from "../components/RoleBadge";
import MembersSection from "./MembersSection";

export default function OrgDetailClient({ orgId }: { orgId: string }) {
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrg(await fetchOrganization(orgId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organization");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const viewerRole: OrgRole = org?.role ?? "user";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/organizations"
          className="text-xs text-[var(--color-text-muted)] hover:underline"
        >
          &larr; All organizations
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-xl font-bold text-[var(--color-text-main)]">
            {org ? org.name : "Organization"}
          </h1>
          {org && <RoleBadge role={org.role} />}
        </div>
        {org && <p className="text-sm text-[var(--color-text-muted)] mt-1">/{org.slug}</p>}
      </div>

      {error && (
        <div
          className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : org ? (
        <MembersSection orgId={orgId} viewerRole={viewerRole} />
      ) : null}
    </div>
  );
}
