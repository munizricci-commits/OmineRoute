"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

const MIN_LEN = 8;

export default function ResetPasswordForm() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError(t("invalidOrExpiredToken"));
      return;
    }
    if (password.length < MIN_LEN) {
      setError(t("passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword: confirm }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        setError(t("resetFailed"));
      }
    } catch {
      setError(t("resetFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border p-4 text-sm" role="status">
        {t("passwordResetSuccess")}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block opacity-70">{t("newPassword")}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border px-3 py-2"
          autoComplete="new-password"
          minLength={MIN_LEN}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block opacity-70">{t("confirmPassword")}</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md border px-3 py-2"
          autoComplete="new-password"
          minLength={MIN_LEN}
        />
      </label>
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
      >
        {busy ? t("resetting") : t("resetPassword")}
      </button>
    </form>
  );
}
