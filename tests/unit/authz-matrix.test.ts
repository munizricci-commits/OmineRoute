/**
 * 09-security-hardening / Task 02 — authorization matrix for platform admin and
 * organization roles (TDD, unit).
 *
 * Documents and guards the minimal platform-role decision surface:
 *  - isPlatformAdmin: active + role==='platform_admin' only
 *  - disabled / blocked users are NOT admins even with the role
 *  - resolvePlatformRole maps principal -> 'platform_admin' | 'user' | null
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec02-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
import { SignJWT } from "jose";
const { isPlatformAdmin, resolvePlatformRole } = await import("../../src/lib/org/principal.ts");

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

test("only active platform_admins pass isPlatformAdmin", () => {
  const admin = createUserSync({ role: "platform_admin" });
  const user = createUserSync({ role: "user" });
  const disabled = createUserSync({ role: "platform_admin", status: "disabled" });
  assert.equal(isPlatformAdmin(admin), true);
  assert.equal(isPlatformAdmin(user), false);
  assert.equal(isPlatformAdmin(disabled), false);
  assert.equal(isPlatformAdmin(null), false);
  assert.equal(isPlatformAdmin(undefined), false);
});

test("resolvePlatformRole maps principal to role", async () => {
  const admin = createUserSync({ role: "platform_admin" });
  const user = createUserSync({ role: "user" });
  assert.equal(await resolvePlatformRole(await makeReq(admin.id)), "platform_admin");
  assert.equal(await resolvePlatformRole(await makeReq(user.id)), "user");
  assert.equal(await resolvePlatformRole(new Request("http://localhost")), null);
});

async function makeReq(sub: string): Request {
  // A pre-signed token carrying `sub`; principal resolution looks up the user.
  const token = (await new SignJWT({ authenticated: true, sub })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!))) as unknown as string;
  return new Request("http://localhost", { headers: { cookie: `auth_token=${token}` } });
}
