/**
 * 05-email-smtp / Task 06 — connect email service to SMTP + observable failures.
 *
 * TDD: fails before smtpTransport buildSmtpTransport/testSmtpConnection wired, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-smtp-transport-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { setSmtpConfig } = await import("../../src/lib/db/smtpConfig.ts");
const { buildSmtpTransport, testSmtpConnection } =
  await import("../../src/lib/email/smtpTransport.ts");

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

test("buildSmtpTransport returns null when SMTP is disabled", async () => {
  const t = await buildSmtpTransport();
  assert.equal(t, null);
});

test("buildSmtpTransport returns a transport when SMTP is enabled", async () => {
  await setSmtpConfig({ enabled: true, host: "smtp.x.io", port: 587, user: "u", password: "pw" });
  const t = await buildSmtpTransport();
  assert.ok(t);
  assert.equal(t!.name, "smtp");
});

test("testSmtpConnection reports valid config without leaking the password", async () => {
  await setSmtpConfig({
    enabled: true,
    host: "smtp.x.io",
    port: 587,
    user: "u",
    password: "secret-pw",
  });
  const res = await testSmtpConnection(false);
  assert.equal(res.ok, true);
  assert.equal(res.transport, "smtp");
  assert.ok(!res.message.includes("secret-pw"));
});

test("testSmtpConnection reports disabled when not enabled", async () => {
  const res = await testSmtpConnection(false);
  assert.equal(res.ok, false);
});
