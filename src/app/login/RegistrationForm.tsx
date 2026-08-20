"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface RegistrationFormProps {
  inviteCode?: string;
}

/**
 * User-facing registration form. Posts to the public /api/auth/register endpoint,
 * which enforces the instance policy server-side. No secrets handled here.
 */
export function RegistrationForm({ inviteCode }: RegistrationFormProps) {
  const t = useTranslations("auth");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginIdentifier: loginIdentifier || undefined,
          email: email || undefined,
          password,
          inviteCode: inviteCode || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message || t("registrationFailed"));
        return;
      }
      setSuccess(true);
    } catch {
      setError(t("registrationFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return <p className="mt-4 text-sm text-green-600">{t("registrationSuccess")}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <input
        type="text"
        value={loginIdentifier}
        onChange={(e) => setLoginIdentifier(e.target.value)}
        placeholder={t("loginIdentifier")}
        className="rounded border border-border px-3 py-2 text-sm"
        autoComplete="username"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("email")}
        className="rounded border border-border px-3 py-2 text-sm"
        autoComplete="email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("password")}
        className="rounded border border-border px-3 py-2 text-sm"
        autoComplete="new-password"
        minLength={8}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy || password.length < 8}
        className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {t("register")}
      </button>
    </form>
  );
}
