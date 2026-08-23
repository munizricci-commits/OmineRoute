"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface SmtpConfigView {
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  from: string | null;
}

/**
 * Admin SMTP configuration panel. Fetches the current config (password never
 * returned), lets the admin edit + save, and test the connection. All calls go
 * to the platform-admin-only /api/admin/smtp endpoints.
 */
export default function SmtpSettings() {
  const t = useTranslations("email");
  const [config, setConfig] = useState<SmtpConfigView>({
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "",
  });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/smtp", { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as SmtpConfigView;
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
      const res = await fetch("/api/admin/smtp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: config.enabled,
          host: config.host || null,
          port: config.port,
          secure: config.secure,
          user: config.user || null,
          password: password || null,
          from: config.from || null,
        }),
      });
      if (res.ok) {
        setStatus(t("saved"));
        setPassword("");
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

  async function testConnection() {
    setTesting(true);
    setStatus("");
    try {
      const res = await fetch("/api/admin/smtp/test", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message: string };
      setStatus(data.message);
    } catch {
      setStatus(t("testError"));
    } finally {
      setTesting(false);
    }
  }

  const inputClass =
    "h-10 w-full px-3 rounded-lg bg-surface border border-border text-sm text-text-main focus:outline-none focus:border-primary disabled:opacity-50";
  const labelClass = "block text-xs font-medium text-text-main";
  const hintClass = "text-xs text-text-muted";

  return (
    <div className="rounded-card bg-card border border-border p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-main">{t("smtpSettings")}</h3>

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
          <label className={labelClass}>{t("host")}</label>
          <input
            className={inputClass}
            value={config.host ?? ""}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>{t("port")}</label>
          <input
            type="number"
            className={inputClass}
            value={config.port ?? 587}
            onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>{t("user")}</label>
          <input
            className={inputClass}
            value={config.user ?? ""}
            onChange={(e) => setConfig({ ...config, user: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>{t("password")}</label>
          <input
            type="password"
            className={inputClass}
            value={password}
            placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className={labelClass}>{t("from")}</label>
          <input
            className={inputClass}
            value={config.from ?? ""}
            onChange={(e) => setConfig({ ...config, from: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-main sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            checked={config.secure}
            onChange={(e) => setConfig({ ...config, secure: e.target.checked })}
          />
          {t("secure")}
        </label>
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
        <button
          type="button"
          disabled={testing}
          onClick={testConnection}
          className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text-main transition-colors hover:bg-bg-subtle disabled:opacity-50"
        >
          {t("testConnection")}
        </button>
      </div>

      {status ? <p className={hintClass}>{status}</p> : null}
    </div>
  );
}
