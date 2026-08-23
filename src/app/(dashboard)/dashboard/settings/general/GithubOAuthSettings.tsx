"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface GithubOAuthConfigView {
  enabled: boolean;
  clientId: string | null;
  redirectUri: string | null;
}

/**
 * Admin GitHub OAuth login configuration panel. Fetches the current config
 * (client secret never returned), lets the admin edit + save. All calls go to
 * the platform-admin-only /api/admin/github-oauth endpoints.
 *
 * Mirrors SmtpSettings.tsx conventions.
 */
export default function GithubOAuthSettings() {
  const t = useTranslations("auth");
  const [config, setConfig] = useState<GithubOAuthConfigView>({
    enabled: false,
    clientId: "",
    redirectUri: "",
  });
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/github-oauth", { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as GithubOAuthConfigView;
        setConfig(data);
      } else if (res.status === 401 || res.status === 403) {
        setStatus(t("adminRequired"));
      }
    } catch {
      setStatus(t("loadError"));
    } finally {
      setLoaded(true);
    }
  }

  if (!loaded) {
    void load();
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/admin/github-oauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: config.enabled,
          clientId: config.clientId || null,
          clientSecret: clientSecret || null,
          redirectUri: config.redirectUri || null,
        }),
      });
      if (res.ok) {
        setStatus(t("saved"));
        setClientSecret("");
      } else if (res.status === 401 || res.status === 403) {
        setStatus(t("adminRequired"));
      } else {
        setStatus(t("saveError"));
      }
    } catch {
      setStatus(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-10 w-full px-3 rounded-lg bg-surface border border-border text-sm text-text-main focus:outline-none focus:border-primary disabled:opacity-50";
  const labelClass = "block text-xs font-medium text-text-main";
  const hintClass = "text-xs text-text-muted";

  return (
    <div className="rounded-card bg-card border border-border p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-main">{t("githubOAuthSettings")}</h3>

      <label className="flex items-center gap-2 text-sm text-text-main">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:outline-none focus:ring-1 focus:ring-primary"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        {t("enabled")}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelClass}>{t("clientId")}</label>
          <input
            className={inputClass}
            value={config.clientId ?? ""}
            onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>{t("clientSecret")}</label>
          <input
            type="password"
            className={inputClass}
            value={clientSecret}
            placeholder="••••••••"
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className={labelClass}>{t("redirectUri")}</label>
          <input
            className={inputClass}
            value={config.redirectUri ?? ""}
            placeholder="/api/auth/github/callback"
            onChange={(e) => setConfig({ ...config, redirectUri: e.target.value })}
          />
          <p className={hintClass}>{t("githubOAuthRedirectHint")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {t("save")}
        </button>
      </div>

      {status ? <p className={hintClass}>{status}</p> : null}
    </div>
  );
}
