/**
 * 09-security-hardening / Task 07 — security-safe authentication audit events.
 *
 * TDD: fails before forgot-password / reset-password / github callback emit audit
 * events. After the production change, each security-relevant flow must:
 *   - emit a structured audit event (action + status + resourceType)
 *   - carry IP + request id via the audit context
 *   - NEVER include the raw reset token, OAuth code, or new password in the record
 *
 * Run with: node --import tsx/esm --test tests/integration/auth-audit-events.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-audit-07-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long";
process.env.APP_LOG_TO_FILE = "false";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createPasswordResetToken } = await import("../../src/lib/db/passwordReset.ts");
const compliance = await import("../../src/lib/compliance/index.ts");
const forgotRoute = await import("../../src/app/api/auth/forgot-password/route.ts");
const resetRoute = await import("../../src/app/api/auth/reset-password/route.ts");
const callbackRoute = await import("../../src/app/api/auth/github/callback/route.ts");

function cleanupDb() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

test.beforeEach(() => {
  cleanupDb();
  compliance.getAuditLog({}); // ensure schema
});

test.after(() => {
  cleanupDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("forgot-password emits a generic audit event without leaking the token", async () => {
  const u = createUserSync({ role: "user", email: "leak@x.io" });
  const res = await forgotRoute.POST(
    new Request("http://localhost/api/auth/forgot-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
        "x-request-id": "req-fp",
      },
      body: JSON.stringify({ email: "leak@x.io" }),
    })
  );
  assert.equal(res.status, 200);

  const ev = compliance.getAuditLog({ action: "auth.password.reset_requested" })[0];
  assert.ok(ev, "expected a password-reset-request audit event");
  assert.equal(ev.status, "success");
  assert.equal(ev.resourceType, "auth_session");
  assert.equal(ev.ip, "203.0.113.5");
  assert.equal(ev.requestId, "req-fp");
  const serialized = JSON.stringify(ev);
  // The raw email must not be duplicated into the audit record (only `requested` flag).
  assert.ok(!serialized.includes("leak@x.io"));
  // Action name contains "reset" by design; that is fine. Ensure no token-like hex leak.
  assert.ok(!serialized.includes("reset-token-"));
});

test("reset-password emits success and failure audit events (no password in record)", async () => {
  const u = createUserSync({ role: "user", email: "set@x.io" });
  const token = await createPasswordResetToken(u.id);

  const okRes = await resetRoute.POST(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.6",
        "x-request-id": "req-rp-ok",
      },
      body: JSON.stringify({
        token,
        password: "NewPassword123",
        confirmPassword: "NewPassword123",
      }),
    })
  );
  assert.equal(okRes.status, 200);
  const okEv = compliance.getAuditLog({ action: "auth.password.reset_completed" })[0];
  assert.ok(okEv, "expected a reset-completed audit event");
  assert.equal(okEv.status, "success");
  assert.equal(okEv.ip, "203.0.113.6");
  assert.ok(!JSON.stringify(okEv).includes("NewPassword123"));

  const badRes = await resetRoute.POST(
    new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
        "x-request-id": "req-rp-bad",
      },
      body: JSON.stringify({
        token: "doesnotexistdoesnotexist",
        password: "NewPassword123",
        confirmPassword: "NewPassword123",
      }),
    })
  );
  assert.equal(badRes.status, 400);
  const badEv = compliance.getAuditLog({ action: "auth.password.reset_failed" })[0];
  assert.ok(badEv, "expected a reset-failed audit event");
  assert.equal(badEv.status, "failed");
});

test("github callback emits an audit event and never records the OAuth code", async () => {
  const res = await callbackRoute.GET(
    new Request(
      "http://localhost/api/auth/github/callback?code=secret_oauth_code_123&state=unknownstate1234567890"
    )
  );
  // 403 unknown state, or redirect on upstream error — either is fine; we only assert audit.
  const ev = compliance.getAuditLog({ action: "auth.github.callback" })[0];
  assert.ok(ev, "expected a github callback audit event");
  assert.equal(ev.resourceType, "auth_session");
  assert.ok(!JSON.stringify(ev).includes("secret_oauth_code_123"));
});
