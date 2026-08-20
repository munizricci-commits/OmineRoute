/**
 * 06-password-recovery / Task 04 — reset-password endpoint + UI validation.
 *
 * Integration proof: POST /api/auth/reset-password consumes a valid token and
 * updates the password (atomic); rejects bad token, weak password, mismatch.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-resetpw-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync, getUserByEmail } = await import("../../src/lib/db/users.ts");
const { setUserPasswordSync, verifyUserPassword } =
  await import("../../src/lib/db/userCredentials.ts");
const { createPasswordResetToken, consumePasswordResetToken } =
  await import("../../src/lib/db/passwordReset.ts");
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

test("valid token + strong password resets the account password", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  setUserPasswordSync(u.id, "OldPassword123");
  const token = await createPasswordResetToken(u.id);
  const res = await routeMod.POST(
    req({ token, password: "NewPassword456", confirmPassword: "NewPassword456" })
  );
  assert.equal(res.status, 200);
  // Password actually changed.
  const user = await getUserByEmail("u@x.io");
  assert.ok(user);
  const ok = await verifyUserPassword(u.id, "NewPassword456");
  assert.equal(ok, true);
});

test("unknown token is rejected", async () => {
  const res = await routeMod.POST(
    req({ token: "deadbeef", password: "NewPassword456", confirmPassword: "NewPassword456" })
  );
  assert.equal(res.status, 400);
});

test("weak password is rejected", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  const res = await routeMod.POST(req({ token, password: "123", confirmPassword: "123" }));
  assert.equal(res.status, 400);
});

test("password mismatch is rejected", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  const res = await routeMod.POST(
    req({ token, password: "NewPassword456", confirmPassword: "Different456" })
  );
  assert.equal(res.status, 400);
});

test("reused (already-consumed) token is rejected", async () => {
  const u = createUserSync({ role: "user", email: "u@x.io" });
  const token = await createPasswordResetToken(u.id);
  await consumePasswordResetToken(token);
  const res = await routeMod.POST(
    req({ token, password: "NewPassword456", confirmPassword: "NewPassword456" })
  );
  assert.equal(res.status, 400);
});
