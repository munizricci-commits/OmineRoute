/**
 * P11.04 — routing performance: org scope resolution must not issue N+1
 * connection queries and must stay bounded with many org connections.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-perf-rt-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const usersDb = await import("../../src/lib/db/users.ts");
const orgsDb = await import("../../src/lib/db/organizations.ts");
const membersDb = await import("../../src/lib/db/members.ts");
const orgConn = await import("../../src/lib/db/orgConnections.ts");
const qr = await import("../../src/lib/org/qualifiedRoute.ts");
const auto = await import("../../src/lib/org/autoScope.ts");

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

test("buildOrgRoutingContext resolves an org with 50 connections in bounded time", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const member = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });
  const ctx = { organizationId: org.id, role: "owner" as const };
  for (let i = 0; i < 50; i++) {
    await orgConn.createOrganizationConnection(
      org.id,
      { name: `conn-${i}`, provider: "openai", apiKey: `sk-${i}`, scope: "organization" },
      ctx
    );
  }
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: owner.id,
  });

  const start = Date.now();
  const resolved = await qr.buildOrgRoutingContext(
    { model: "teama/combo:dev" },
    { userId: member.id, user: member, isOrganizationScoped: false }
  );
  const elapsed = Date.now() - start;

  assert.equal(resolved.denied, false);
  assert.equal(resolved.organizationId, org.id);
  assert.ok(resolved.connectionIds.length >= 50, "all org connections enumerated");
  assert.ok(elapsed < 2000, `resolution bounded (${elapsed}ms for 50 connections)`);
});

test("resolveAutoRoutingScope with 50 org connections enumerates once and stays scoped", async () => {
  const owner = await usersDb.createUser({ role: "user" });
  const member = await usersDb.createUser({ role: "user" });
  const org = await orgsDb.createOrganization({ name: "A", slug: "teama", ownerUserId: owner.id });
  const ctx = { organizationId: org.id, role: "owner" as const };
  for (let i = 0; i < 50; i++) {
    await orgConn.createOrganizationConnection(
      org.id,
      { name: `conn-${i}`, provider: "openai", apiKey: `sk-${i}`, scope: "organization" },
      ctx
    );
  }
  await membersDb.addMember({
    organizationId: org.id,
    userId: member.id,
    role: "user",
    actorUserId: owner.id,
  });

  const scope = await auto.resolveAutoRoutingScope(
    { model: "teama/auto:coding" },
    { userId: member.id, user: member, isOrganizationScoped: false }
  );
  assert.equal(scope.scope, "organization");
  assert.ok(
    scope.connectionIds && scope.connectionIds.length >= 50,
    "auto pool scoped to org connections"
  );
});
