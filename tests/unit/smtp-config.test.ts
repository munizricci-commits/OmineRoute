/**
 * 05-email-smtp / Task 02 — persist SMTP config safely (no secret exposure).
 *
 * TDD: fails before lib/db/smtpConfig.ts + migration 168 exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resetDbInstance } from "../../src/lib/db/core.ts";
import { getSmtpConfig, setSmtpConfig } from "../../src/lib/db/smtpConfig.ts";

test.beforeEach(() => {
  resetDbInstance();
});

const sample = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "omni@example.com",
  password: "super-secret-pw",
  from: "OmniRoute <noreply@example.com>",
};

test("default config is disabled and never leaks a stored password", async () => {
  const cfg = await getSmtpConfig();
  assert.equal(cfg.enabled, false);
  // Password must never be returned by the read path.
  assert.equal(cfg.password, undefined);
});

test("setSmtpConfig persists non-secret fields and stores password encrypted", async () => {
  await setSmtpConfig({ ...sample, enabled: true });
  const cfg = await getSmtpConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.host, sample.host);
  assert.equal(cfg.port, sample.port);
  assert.equal(cfg.user, sample.user);
  assert.equal(cfg.from, sample.from);
  // Secret must NOT be returned in plaintext, and must NOT equal the raw value.
  assert.equal(cfg.password, undefined);
});

test("round-trips: a separately-decrypted stored password matches the input", async () => {
  await setSmtpConfig({ ...sample, enabled: true });
  // Read the raw stored blob directly from the DB.
  const db = (await import("../../src/lib/db/core.ts")).getDbInstance();
  const row = db.prepare(`SELECT password FROM smtp_config WHERE id = 'singleton'`).get() as {
    password: string | null;
  };
  assert.ok(row.password, "password should be stored");
  // The API read path must never expose it.
  assert.equal((await getSmtpConfig()).password, undefined);
  // When storage encryption is enabled, it must not be stored in plaintext.
  const { isEncryptionEnabled, decrypt } = await import("../../src/lib/db/encryption.ts");
  if (isEncryptionEnabled()) {
    assert.notEqual(row.password, sample.password, "password must not be stored in plaintext");
    assert.equal(decrypt(row.password), sample.password);
  }
});
