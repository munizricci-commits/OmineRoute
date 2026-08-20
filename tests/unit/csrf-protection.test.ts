/**
 * 09-security-hardening / Task 06 — cookie flags, CSRF protection, security headers (TDD).
 *
 * Verifies the dashboard CSRF mechanism: tokens are bound to the session cookie
 * (HMAC over auth_token), so a token minted for one session cannot be replayed
 * against another. Unauthenticated requests cannot mint a token. This is the
 * double-submit-style CSRF control used by the dashboard mutation endpoints.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  issueDashboardCsrfToken,
  validateDashboardCsrfToken,
} from "../../src/server/authz/csrf.ts";
import { DASHBOARD_CSRF_HEADER } from "@/shared/constants/dashboardCsrf";

function makeSessionToken(sub: string): Promise<string> {
  return new SignJWT({ authenticated: true, sub })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

function reqWith(authToken: string | null, csrfToken?: string): Request {
  const headers: Record<string, string> = {};
  if (authToken) headers.cookie = `auth_token=${authToken}`;
  if (csrfToken) headers[DASHBOARD_CSRF_HEADER] = csrfToken;
  return new Request("http://localhost", { headers });
}

test.before(() => {
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long";
});

test("CSRF token cannot be minted without a session", () => {
  const token = issueDashboardCsrfToken(reqWith(null));
  assert.equal(token, null);
});

test("issued CSRF token validates against the same session", async () => {
  const session = await makeSessionToken("user-1");
  const issued = issueDashboardCsrfToken(reqWith(session));
  assert.ok(issued);
  assert.ok(issued!.token.startsWith("v1."));
  const ok = validateDashboardCsrfToken(reqWith(session, issued!.token));
  assert.equal(ok, true);
});

test("CSRF token from a different session is rejected (cross-session replay)", async () => {
  const sessionA = await makeSessionToken("user-a");
  const sessionB = await makeSessionToken("user-b");
  const issuedForA = issueDashboardCsrfToken(reqWith(sessionA));
  assert.ok(issuedForA);
  // Replay A's token against B's session -> must fail (bound to A's auth_token).
  const ok = validateDashboardCsrfToken(reqWith(sessionB, issuedForA!.token));
  assert.equal(ok, false);
});

test("missing CSRF header fails validation", async () => {
  const session = await makeSessionToken("user-1");
  assert.equal(validateDashboardCsrfToken(reqWith(session)), false);
});
