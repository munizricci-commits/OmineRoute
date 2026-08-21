"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { formatMemberships } from "@/lib/auth/userDetailView";
import { nextBlockActionStatus, blockActionLabel } from "@/lib/auth/userBlockActions";

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
 * selected user from the platform-admin-only GET /api/auth/users/:id, and exposes a
 * confirmed block/unblock action (POST /api/auth/users/:id/status). Server enforces
 * authorization; protected accounts are rejected by the API (409). No secrets shown.
 */
export function UserDetailPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations("auth");
  const [detail, setDetail] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  async function applyStatus() {
    if (!detail) return;
    const next = nextBlockActionStatus(detail.status);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/users/${userId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? t("protectedAccount")
            : res.status === 403
              ? t("accessDenied")
              : t("actionFailed")
        );
        return;
      }
      const data = await res.json();
      setDetail((d) => (d ? { ...d, status: data.status } : d));
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const actionLabel = detail ? blockActionLabel(detail.status) : "block";

  return (
    <div className="mt-4 rounded-lg border border-border bg-[var(--color-surface)] p-4">
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
        <>
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
          <div className="mt-3">
            <button
              type="button"
              disabled={busy || detail.platformRole === "platform_admin"}
              onClick={() => setConfirmOpen(true)}
              className="rounded border border-border px-3 py-1 text-sm text-[var(--color-text-main)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
            >
              {t(actionLabel)}
            </button>
            {detail.platformRole === "platform_admin" && (
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                {t("protectedAccount")}
              </span>
            )}
          </div>
          {confirmOpen && (
            <div className="mt-3 rounded border border-border p-3 text-sm">
              <p className="text-[var(--color-text-main)]">
                {t("confirmAction", { action: t(actionLabel) })}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={applyStatus}
                  className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
                >
                  {t(actionLabel)}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmOpen(false)}
                  className="rounded border border-border px-3 py-1 text-[var(--color-text-muted)]"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
