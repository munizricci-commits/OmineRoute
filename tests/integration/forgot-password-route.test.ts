/**
 * 06-password-recovery / Task 02 — forgot-password endpoint with anti-enumeration.
 *
 * Integration proof: POST /api/auth/forgot-password always returns 200 with a
 * generic message, never reveals whether the email exists, and only triggers a
 * reset email (token creation) for real users.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-forgot-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { countResetTokensForUser } = await import("../../src/lib/db/passwordReset.ts");
const routeMod = await import("../../src/app/api/auth/forgot-password/route.ts");

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
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("forgot-password for an existing user returns 200 and creates a token", async () => {
  const u = createUserSync({ role: "user", email: "exists@x.io" });
  const res = await routeMod.POST(req({ email: "exists@x.io" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  // Generic message — must not confirm the account exists or reveal the email.
  const s = JSON.stringify(body).toLowerCase();
  assert.ok(!s.includes("exists@x.io"));
  assert.ok(!/no account|not found|unknown user|email not|does not exist/.test(s));
  assert.equal(await countResetTokensForUser(u.id), 1);
});

test("forgot-password for a non-existent user still returns 200 (no enumeration)", async () => {
  const res = await routeMod.POST(req({ email: "nobody@x.io" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  const s = JSON.stringify(body).toLowerCase();
  assert.ok(!s.includes("nobody@x.io"));
  assert.ok(!/no account|not found|unknown user|email not|does not exist/.test(s));
});

test("forgot-password with invalid email returns 400 (but not 404/enumeration)", async () => {
  const res = await routeMod.POST(req({ email: "not-an-email" }));
  assert.equal(res.status, 400);
});

test("malformed JSON returns 400, not 500", async () => {
  const bad = new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  const res = await routeMod.POST(bad);
  assert.equal(res.status, 400);
});
