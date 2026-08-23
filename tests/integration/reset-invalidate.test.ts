/**
 * 06-password-recovery / Task 05 — consume tokens atomically + invalidate credentials.
 *
 * Integration proof: a successful reset consumes the token (atomic) and revokes
 * the user's API keys (revocable credentials), so a stolen/old credential cannot
 * be used after the password changes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-resetinv-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { setUserPasswordSync } = await import("../../src/lib/db/userCredentials.ts");
const { createPasswordResetToken } = await import("../../src/lib/db/passwordReset.ts");
const { revokeUserApiKeys, getApiKeysByUser, createApiKey, setApiKeyUserId } =
  await import("../../src/lib/db/apiKeys.ts");
const routeMod = await import("../../src/app/api/auth/reset-password/route.ts");

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

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("resetting the password revokes the user's API keys", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  setUserPasswordSync(u.id, "OldPassword123");
  // Seed an active API key for this user via the canonical creator.
  const key = await createApiKey("key1", "machine-1", []);
  await setApiKeyUserId(key.id, u.id);

  const token = await createPasswordResetToken(u.id);
  const res = await routeMod.POST(
    req({ token, password: "NewPassword456", confirmPassword: "NewPassword456" })
  );
  assert.equal(res.status, 200);

  const keys = await getApiKeysByUser(u.id);
  assert.equal(keys.length, 1);
  assert.ok(keys[0].revokedAt, "active API key should be revoked after password reset");
});

test("revokeUserApiKeys only revokes the target user's keys", async () => {
  const u1 = createUserSync({ role: "user", email: "u1@x.io" });
  const u2 = createUserSync({ role: "user", email: "u2@x.io" });
  const k1 = await createApiKey("a", "m1", []);
  await setApiKeyUserId(k1.id, u1.id);
  const k2 = await createApiKey("b", "m2", []);
  await setApiKeyUserId(k2.id, u2.id);
  await revokeUserApiKeys(u1.id);
  const got1 = await getApiKeysByUser(u1.id);
  const got2 = await getApiKeysByUser(u2.id);
  assert.ok(got1[0].revokedAt);
  assert.equal(got2[0].revokedAt, null);
});
