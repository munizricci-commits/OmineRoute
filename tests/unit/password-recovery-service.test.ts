/**
 * 06-password-recovery / Task 03 — send reset links through the email service.
 *
 * TDD: fails before passwordRecoveryService.sendPasswordResetEmail exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-pwrec-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { setSmtpConfig, getSmtpConfig } = await import("../../src/lib/db/smtpConfig.ts");
const { sendPasswordResetEmail } = await import("../../src/lib/auth/passwordRecoveryService.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("sendPasswordResetEmail renders the link and dispatches via the email service", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const result = await sendPasswordResetEmail(u.id, "u@x.io", "raw-token-abc");
  assert.equal(result.dispatched, true);
  assert.ok(result.message.includes("raw-token-abc"));
});

test("sendPasswordResetEmail does not throw when SMTP is disabled", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const cfg = await getSmtpConfig();
  assert.equal(cfg.enabled, false);
  await assert.doesNotReject(() => sendPasswordResetEmail(u.id, "u@x.io", "tok"));
});

test("sendPasswordResetEmail tolerates a configured-but-unreachable SMTP (no throw)", async () => {
  await setSmtpConfig({ enabled: true, host: "localhost", port: 9, user: "u", password: "pw" });
  const u = createUserSync({ role: "user", email: "u@x.io" });
  // The recovery flow must never surface SMTP failures to the caller (anti-enumeration).
  await assert.doesNotReject(() => sendPasswordResetEmail(u.id, "u@x.io", "tok2"));
});
