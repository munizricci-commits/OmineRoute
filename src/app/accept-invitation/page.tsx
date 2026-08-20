"use client";

import { Suspense } from "react";
import AcceptInvitationForm from "./AcceptInvitationForm";

export default function AcceptInvitationPage() {
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-xl font-semibold">OmniRoute</h1>
      <Suspense fallback={<div className="text-sm text-text-muted">Loading…</div>}>
        <AcceptInvitationForm />
      </Suspense>
    </main>
  );
}
