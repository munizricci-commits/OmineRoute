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

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{t("smtpSettings")}</h3>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        {t("enabled")}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          {t("host")}
          <input
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
            value={config.host ?? ""}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
          />
        </label>
        <label className="text-xs">
          {t("port")}
          <input
            type="number"
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
            value={config.port ?? 587}
            onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs">
          {t("user")}
          <input
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
            value={config.user ?? ""}
            onChange={(e) => setConfig({ ...config, user: e.target.value })}
          />
        </label>
        <label className="text-xs">
          {t("password")}
          <input
            type="password"
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
            value={password}
            placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="text-xs">
          {t("from")}
          <input
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
            value={config.from ?? ""}
            onChange={(e) => setConfig({ ...config, from: e.target.value })}
          />
        </label>
        <label className="flex items-end gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.secure}
            onChange={(e) => setConfig({ ...config, secure: e.target.checked })}
          />
          {t("secure")}
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          {t("save")}
        </button>
        <button
          type="button"
          disabled={testing}
          onClick={testConnection}
          className="rounded border border-border px-3 py-1 text-xs disabled:opacity-50"
        >
          {t("testConnection")}
        </button>
      </div>

      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
    </div>
  );
}
