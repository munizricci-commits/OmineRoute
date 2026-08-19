/**
 * 02-multi-user-mode / Task 02 — instance-settings API authorization (integration).
 *
 * Proves the platform-admin gate is enforced by the route layer end-to-end:
 * an ordinary user is rejected (403), a platform admin succeeds (200). No secrets
 * are exposed in error bodies.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-instance-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.JWT_SECRET = "jwt-secret-instance-route";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const route = await import("../../src/app/api/auth/instance-settings/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

async function makeToken(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

function reqWithCookie(token?: string, body?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["cookie"] = `auth_token=${token}`;
  return new Request("http://localhost/api/auth/instance-settings", {
    method: body ? "POST" : "GET",
    headers,
    body,
  });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("platform admin can read settings via the API (200)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const token = await makeToken(admin.id);
  const res = await route.GET(reqWithCookie(token));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.settings.multiUserEnabled, false);
  assert.equal(body.settings.registrationPolicy, "disabled");
});

test("ordinary user is rejected by the API (403), no settings disclosed", async () => {
  const user = await usersDb.createUser({ role: "user" });
  const token = await makeToken(user.id);
  const res = await route.GET(reqWithCookie(token));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.settings, undefined);
});

test("platform admin can enable multi-user mode via POST (200)", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const token = await makeToken(admin.id);
  const res = await route.POST(
    reqWithCookie(
      token,
      JSON.stringify({ multiUserEnabled: true, registrationPolicy: "invite-only" })
    )
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.settings.multiUserEnabled, true);
  assert.equal(body.settings.registrationPolicy, "invite-only");
});

test("invalid registration policy is rejected safely (400), no partial state", async () => {
  const admin = await usersDb.createUser({ role: "platform_admin" });
  const token = await makeToken(admin.id);
  const res = await route.POST(
    reqWithCookie(token, JSON.stringify({ registrationPolicy: "open-public" }))
  );
  assert.equal(res.status, 400);
});
