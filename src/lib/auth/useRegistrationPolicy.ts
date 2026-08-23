"use client";

import { useState, useEffect } from "react";
import { isRegistrationAllowed } from "@/lib/auth/registrationPolicy";

/**
 * Client hook: resolves whether the Register control should be shown, based on
 * the public registration-visibility settings (read from /api/settings/require-login,
 * which is reachable without a session). UI visibility only — the actual
 * registration endpoint enforces the gate server-side (Task 04).
 */
export function useRegistrationPolicy() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/require-login", { method: "GET" });
        if (!res.ok) {
          if (active) setAllowed(false);
          return;
        }
        const data = await res.json();
        if (!active) return;
        setAllowed(isRegistrationAllowed(data));
      } catch {
        if (active) setAllowed(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return allowed;
}
