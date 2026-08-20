"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export default function AcceptInvitationForm() {
  const t = useTranslations("invitation");
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function accept() {
    if (!token) {
      setStatus("error");
      setMessage(t("missingToken"));
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/accept-invitation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setStatus("ok");
        setMessage(t("accepted"));
      } else if (res.status === 409) {
        setStatus("error");
        setMessage(t("alreadyUsed"));
      } else if (res.status === 404) {
        setStatus("error");
        setMessage(t("notFound"));
      } else {
        setStatus("error");
        setMessage(t("genericError"));
      }
    } catch {
      setStatus("error");
      setMessage(t("networkError"));
    }
  }

  return (
    <div className="space-y-4">
      {status === "ok" ? (
        <div className="rounded border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-300">
          {message}
          <div className="mt-2">
            <a href="/login" className="text-primary underline">
              {t("goLogin")}
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">{t("confirmJoin")}</p>
          {status === "error" && <p className="text-sm text-red-400">{message}</p>}
          <button
            type="button"
            onClick={accept}
            disabled={status === "loading"}
            className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "loading" ? t("accepting") : t("accept")}
          </button>
        </div>
      )}
    </div>
  );
}
