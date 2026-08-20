"use client";

import { useState, useEffect } from "react";
import { deriveRegistrationAllowed } from "@/lib/auth/registrationVisibility";

/**
 * Client hook: resolves whether the Register control should be shown, based on
 * the server-backed instance auth settings. UI visibility only — the actual
 * registration endpoint enforces the gate server-side (Task 04).
 */
export function useRegistrationPolicy() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/instance-settings", { method: "GET" });
        if (!res.ok) {
          if (active) setAllowed(false);
          return;
        }
        const data = await res.json();
        if (!active) return;
        setAllowed(deriveRegistrationAllowed(data?.settings));
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
