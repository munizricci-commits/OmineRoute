"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createOrganization, fetchOrganizations } from "./apiClient";
import type { OrganizationSummary } from "./types";
import MultiUserModeToggle from "./MultiUserModeToggle";
import { UsersTable } from "./UsersTable";

/** Derive a kebab-case slug from a display name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  moderator: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  user: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export default function OrganizationsClient() {
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrgs(await fetchOrganizations());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createOrganization({ name: name.trim(), slug: slug.trim() });
      setName("");
      setSlug("");
      setSlugTouched(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-main)]">Organizations</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Teams you belong to and their shared routing resources.
        </p>
      </div>

      <MultiUserModeToggle />
      <UsersTable />

      {error && (
        <div
          className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Create organization */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text-main)] mb-3">
          Create organization
        </h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-[var(--color-text-muted)]">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Team"
                className="mt-1 w-full rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-main)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[var(--color-text-muted)]">Slug</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="my-team"
                className="mt-1 w-full rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-main)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
          <button
            type="submit"
            disabled={creating || !name.trim() || !slug.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create organization"}
          </button>
        </form>
      </div>

      {/* Organization list */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
        {loading ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : orgs.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">
            You are not a member of any organization yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {orgs.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/dashboard/organizations/${org.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--color-bg-alt)] transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium text-[var(--color-text-main)]">
                      {org.name}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">/{org.slug}</div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      ROLE_BADGE[org.role] ?? ROLE_BADGE.user
                    }`}
                  >
                    {org.role}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
