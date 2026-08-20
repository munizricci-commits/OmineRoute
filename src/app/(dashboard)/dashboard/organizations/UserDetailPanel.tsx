"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { formatMemberships } from "@/lib/auth/userDetailView";

interface UserDetailData {
  id: string;
  email: string | null;
  displayName: string | null;
  loginIdentifier: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  platformRole: string;
  memberships: Array<{ organizationId: string; userId: string; role: string; status: string }>;
}

/**
 * User detail panel. Fetches safe detail (platform role + org memberships) for the
 * selected user from the platform-admin-only GET /api/auth/users/:id. Server enforces
 * authorization. Read-only; block/unblock actions land in later tasks.
 */
export function UserDetailPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations("auth");
  const [detail, setDetail] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/auth/users/${userId}`, { method: "GET" });
        if (!res.ok) {
          if (active)
            setError(
              res.status === 403
                ? t("accessDenied")
                : res.status === 404
                  ? t("userNotFound")
                  : t("loadError")
            );
          return;
        }
        const data = await res.json();
        if (!active) return;
        setDetail(data);
      } catch {
        if (active) setError(t("loadError"));
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, t]);

  return (
    <div className="mt-4 rounded-lg border border-border bg-[var(--color-bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-main)]">{t("userDetails")}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-[var(--color-text-muted)] hover:text-primary"
        >
          {t("close")}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {!error && !detail && (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t("loading")}</p>
      )}
      {!error && detail && (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-[var(--color-text-muted)]">{t("role")}:</dt>
            <dd className="text-[var(--color-text-main)]">{detail.platformRole}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-text-muted)]">{t("status")}:</dt>
            <dd className="text-[var(--color-text-main)]">{detail.status}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-text-muted)]">{t("organizations")}:</dt>
            <dd className="text-[var(--color-text-main)]">
              {formatMemberships(detail.memberships).join(", ") || t("none")}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
