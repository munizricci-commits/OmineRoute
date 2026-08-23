/**
 * POST /api/auth/reset-password
 *
 * Consumes a one-time reset token (atomic) and sets a new password. Validates
 * token presence, password policy and confirmation match. Fails closed: unknown
 * / used / expired tokens and weak or mismatched passwords return 400 with a
 * generic error (no token-state disclosure).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken } from "@/lib/db/passwordReset";
import { setUserPasswordSync } from "@/lib/db/userCredentials";
import { revokeUserApiKeys } from "@/lib/db/apiKeys";
import { DEFAULT_PASSWORD_POLICY } from "@/lib/auth/passwordPolicy";
import { getAuditRequestContext, logAuditEvent } from "@/lib/compliance/index";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

const schema = z
  .object({
    token: z.string().min(16),
    password: z
      .string()
      .min(DEFAULT_PASSWORD_POLICY.minLength)
      .max(DEFAULT_PASSWORD_POLICY.maxLength),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "passwords do not match",
    path: ["confirmPassword"],
  });

export async function POST(request: Request) {
  const auditContext = getAuditRequestContext(request);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid JSON body"), { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(buildErrorBody("bad_request", "Invalid reset request"), {
      status: 400,
    });
  }

  const { token, password } = parsed.data;
  const meta = await consumePasswordResetToken(token);
  if (!meta) {
    // Unknown / already-used / expired. Generic failure, no token-state leak.
    logAuditEvent({
      action: "auth.password.reset_failed",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "invalid_or_expired_token" },
    });
    return NextResponse.json(buildErrorBody("bad_request", "Invalid or expired reset token"), {
      status: 400,
    });
  }

  try {
    setUserPasswordSync(meta.userId, password);
  } catch (e) {
    // Password policy (e.g. denylist) failure.
    logAuditEvent({
      action: "auth.password.reset_failed",
      actor: meta.userId,
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "password_policy" },
    });
    return NextResponse.json(buildErrorBody("bad_request", "Password does not meet policy"), {
      status: 400,
    });
  }

  // Invalidate revocable credentials so a pre-reset key/session cannot be reused.
  await revokeUserApiKeys(meta.userId);

  logAuditEvent({
    action: "auth.password.reset_completed",
    actor: meta.userId,
    target: "dashboard-auth",
    resourceType: "auth_session",
    status: "success",
    ipAddress: auditContext.ipAddress || undefined,
    requestId: auditContext.requestId,
    metadata: { apiKeysRevoked: true },
  });

  return NextResponse.json({ message: "Password has been reset." }, { status: 200 });
}
