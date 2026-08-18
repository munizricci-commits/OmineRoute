/**
 * P11.02 — secret-redaction: provider credentials must never appear in org
 * connection lists, and org API error responses must not leak raw errors.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec-redact-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret-redact";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const orgConn = await import("../../src/lib/db/orgConnections.ts");
const authz = await import("../../src/lib/org/authorization.ts");
const api = await import("../../src/lib/org/orgApiService.ts");

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}
test.beforeEach(() => resetStorage());
test.after(() => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

function p(id: string) {
  return { params: Promise.resolve({ id }) } as { params: Promise<{ id: string }> };
}
async function authedGet(userId: string, url: string): Promise<Request> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .sign(secret);
  return new Request(url, { method: "GET", headers: { Cookie: `auth_token=${token}` } });
}

test("redactConnectionCredentials strips credential fields for non-full visibility", () => {
  const conn = {
    id: "conn-1",
    name: "acme",
    apiKey: "sk-SUPER-SECRET",
    accessToken: "at-SECRET",
    refreshToken: "rt-SECRET",
    idToken: "it-SECRET",
    scope: "organization",
  };
  const redacted = authz.redactConnectionCredentials(conn, "none") as Record<string, unknown>;
  for (const field of ["apiKey", "accessToken", "refreshToken", "idToken"]) {
    assert.equal(redacted[field], undefined, `${field} must be stripped`);
  }
  assert.equal(redacted.id, "conn-1", "non-credential fields preserved");
});

test("org connection list API response contains no raw credential values for a non-owner viewer", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const viewer = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });
  const ctx = { organizationId: org.id, role: "owner" as const };
  await orgConn.createOrganizationConnection(
    org.id,
    { name: "acme", provider: "openai", apiKey: "sk-REAL-SECRET-VALUE", scope: "organization" },
    ctx
  );
  // Add the viewer as a plain (non-owner) member so they can read the list, but
  // with non-full visibility their view must NOT include the raw secret.
  await membersDb.addMember({
    organizationId: org.id,
    userId: viewer.id,
    role: "user",
    actorUserId: owner.id,
  });

  const req = await authedGet(
    viewer.id,
    `http://localhost/api/organizations/${org.id}/connections`
  );
  const res = await api.listConnectionsHandler(req, p(org.id));
  assert.equal(res.status, 200);
  const body = await res.json();
  const serialized = JSON.stringify(body);
  assert.equal(
    serialized.includes("sk-REAL-SECRET-VALUE"),
    false,
    "raw apiKey must not appear for non-full viewer"
  );
});

test("non-member connection list errors are fail-closed (no raw leak)", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const outsider = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });

  const req = await authedGet(
    outsider.id,
    `http://localhost/api/organizations/${org.id}/connections`
  );
  const res = await api.listConnectionsHandler(req, p(org.id));
  assert.equal(res.status, 404);
  const txt = await res.text();
  assert.equal(txt.includes("at "), false, "404 body must not contain a stack trace");
});
