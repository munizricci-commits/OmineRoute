"use client";

import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-xl font-semibold">Reset password</h1>
      <Suspense fallback={<div className="text-sm opacity-70">Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
