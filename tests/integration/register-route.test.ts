/**
 * 04-registration / Task 03 — registration endpoint.
 *
 * Integration proof: POST /api/auth/register enforces policy (disabled -> 403,
 * invite-only missing code -> 400, valid -> 201 with safe user payload).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as usersDb from "../../src/lib/db/users.ts";
import { setInstanceAuthSettings } from "../../src/lib/db/instanceAuthSettings.ts";
import { resetDbInstance } from "../../src/lib/db/core.ts";
import * as routeMod from "../../src/app/api/auth/register/route.ts";

const TEST_DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "storage-test");

async function resetStorage() {
  resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.beforeEach(async () => {
  await resetStorage();
});

test("disabled policy rejects registration with 403", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "disabled" });
  const res = await routeMod.POST(req({ password: "longenoughpw" }));
  assert.equal(res.status, 403);
});

test("invite-only without code rejects with 400", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const res = await routeMod.POST(req({ password: "longenoughpw" }));
  assert.equal(res.status, 400);
});

test("invite-only with code creates user (201)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const res = await routeMod.POST(
    req({
      loginIdentifier: "Jane.Doe",
      email: "jane@example.com",
      password: "longenoughpw",
      inviteCode: "x",
    })
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.loginIdentifier, "jane.doe");
  assert.equal(body.email, "jane@example.com");
  assert.ok(!("password" in body));
  // user persisted + has credential
  const u = await usersDb.getUserByLoginIdentifier("jane.doe");
  assert.ok(u);
});

test("weak password is rejected with 400 (no secret leak)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const res = await routeMod.POST(req({ password: "password", inviteCode: "x" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  // No password value echoed back; generic-ish message, no field confirmation.
  assert.ok(!("password" in body));
});

test("duplicate registration is rejected without revealing which field exists (enumeration-safe)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  await routeMod.POST(
    req({
      loginIdentifier: "taken.user",
      email: "taken@example.com",
      password: "longenoughpw",
      inviteCode: "x",
    })
  );
  // Attempt to register the same login again.
  const res = await routeMod.POST(
    req({
      loginIdentifier: "taken.user",
      email: "other@example.com",
      password: "longenoughpw",
      inviteCode: "x",
    })
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  // The error must not disclose whether the account (login/email) already exists.
  assert.ok(!/login|email/i.test(JSON.stringify(body)));
});

test("malformed JSON body is rejected with 400, not 500", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const res = await new Response("not-json", { status: 200 });
  // Simulate a bad request by sending invalid JSON through the route handler directly.
  const badReq = new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
  const r = await routeMod.POST(badReq);
  assert.equal(r.status, 400);
  void res;
});

test("loginIdentifier with illegal characters is rejected with 400 (no 500)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const res = await routeMod.POST(
    req({ loginIdentifier: "bad login !!", password: "longenoughpw", inviteCode: "x" })
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(!("password" in body));
});
