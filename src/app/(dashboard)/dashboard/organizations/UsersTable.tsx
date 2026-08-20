"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { userSummaryLabel, type UserSummaryInput } from "@/lib/auth/userRow";

interface UserRow extends UserSummaryInput {}

/**
 * Admin Users table. Lists instance users with safe summary fields fetched from
 * the platform-admin-only GET /api/auth/users. Read-only here; row actions
 * (detail, block/unblock) land in later tasks. Server enforces authorization.
 */
export function UsersTable() {
  const t = useTranslations("auth");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/users", { method: "GET" });
        if (!res.ok) {
          if (active) setError(res.status === 403 ? t("accessDenied") : t("loadError"));
          return;
        }
        const data = await res.json();
        if (!active) return;
        setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch {
        if (active) setError(t("loadError"));
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  return (
    <div className="rounded-lg border border-border bg-[var(--color-bg-surface)] p-4">
      <h2 className="text-base font-semibold text-[var(--color-text-main)]">{t("users")}</h2>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {!error && users === null && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t("loading")}</p>
      )}
      {!error && users && users.length === 0 && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t("noUsers")}</p>
      )}
      {!error && users && users.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-muted)]">
                <th className="px-2 py-1 font-medium">{t("user")}</th>
                <th className="px-2 py-1 font-medium">{t("role")}</th>
                <th className="px-2 py-1 font-medium">{t("status")}</th>
                <th className="px-2 py-1 font-medium">{t("created")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-2 py-1 text-[var(--color-text-main)]">{userSummaryLabel(u)}</td>
                  <td className="px-2 py-1 text-[var(--color-text-muted)]">{u.role}</td>
                  <td className="px-2 py-1 text-[var(--color-text-muted)]">{u.status}</td>
                  <td className="px-2 py-1 text-[var(--color-text-muted)]">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
