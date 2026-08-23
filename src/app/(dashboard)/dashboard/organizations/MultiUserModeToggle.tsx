"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { buildInstanceSettingsPayload } from "@/lib/auth/instanceSettingsPayload";

/**
 * Multi-user mode toggle (Phase 02 / Task 03).
 *
 * Reads the current instance auth settings from /api/auth/instance-settings and
 * lets a platform admin switch multi-user mode on/off. The platform-admin
 * authorization is enforced server-side by the API; this component only renders
 * the control and reflects the persisted state. UI visibility is NOT authorization.
 */
export default function MultiUserModeToggle() {
  const t = useTranslations("organizations");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<"disabled" | "invite-only">("disabled");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/instance-settings", { method: "GET" });
        if (!res.ok) {
          if (res.status === 403) {
            // Not a platform admin — the caller should not even render this.
            if (active) setError(t("adminOnlySettings"));
            return;
          }
          throw new Error("Failed to load settings");
        }
        const data = await res.json();
        if (!active) return;
        setEnabled(Boolean(data?.settings?.multiUserEnabled));
        setPolicy(
          data?.settings?.registrationPolicy === "invite-only" ? "invite-only" : "disabled"
        );
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/instance-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInstanceSettingsPayload(next, policy)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to update settings");
      }
      const data = await res.json();
      setEnabled(Boolean(data?.settings?.multiUserEnabled));
      setPolicy(data?.settings?.registrationPolicy === "invite-only" ? "invite-only" : "disabled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <span className="text-sm text-text-muted">{t("loadingSettings")}</span>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text-main">{t("multiUserMode")}</h3>
          <p className="text-xs text-text-muted mt-1">{t("multiUserModeDescription")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          disabled={saving || enabled === null}
          onClick={() => handleToggle(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-primary" : "bg-zinc-600"
          } ${saving ? "opacity-60 cursor-not-allowed" : ""}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-3 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">error</span>
          {error}
        </p>
      )}
      <p className="text-[11px] text-text-muted/60 mt-3">{t("multiUserModeHint")}</p>
    </div>
  );
}
