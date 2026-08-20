/**
 * 08-github-oauth / Task 04 — callback validation, identity lookup and account
 * creation/linking rules (pure logic, TDD).
 *
 * TDD: fails before lib/db/externalIdentities.ts + lib/auth/githubCallback.ts
 * exist, then passes. Rules enforced:
 *  - existing external link -> log in as that user (no new account)
 *  - no link but matching verified email -> safe-link to existing user
 *  - no link and no match -> provision a new user + link (single identity)
 *  - UNIQUE(provider,sub) prevents one external id mapping to two users
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghcb-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync, getUserByEmail } = await import("../../src/lib/db/users.ts");
const { linkExternalIdentity, findUserByExternalId, getExternalIdentitiesForUser } =
  await import("../../src/lib/db/externalIdentities.ts");
const { resolveOrProvisionGitHubUser } = await import("../../src/lib/auth/githubCallback.ts");
const { normalizeExternalProfile } = await import("../../src/lib/auth/identityProvider.ts");

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

test("existing external link logs in as the linked user without creating a new one", async () => {
  const u = createUserSync({ role: "user", email: "ghuser@x.io" });
  await linkExternalIdentity({
    provider: "github",
    sub: "gh-123",
    userId: u.id,
    email: "ghuser@x.io",
  });

  const profile = normalizeExternalProfile("github", {
    sub: "gh-123",
    email: "ghuser@x.io",
    login: "ghuser",
  });
  const res = await resolveOrProvisionGitHubUser(profile);
  assert.equal(res.userId, u.id);
  assert.equal(res.created, false);
  assert.equal(res.linked, false);
  // No second user created.
  const db = core.getDbInstance();
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
  assert.equal(count, 1);
});

test("no link but matching email safely links to the existing user", async () => {
  const u = createUserSync({ role: "user", email: "ghuser@x.io" });
  const profile = normalizeExternalProfile("github", {
    sub: "gh-999",
    email: "ghuser@x.io",
    login: "ghuser",
  });
  const res = await resolveOrProvisionGitHubUser(profile);
  assert.equal(res.userId, u.id);
  assert.equal(res.created, false);
  assert.equal(res.linked, true);
  const ident = await findUserByExternalId("github", "gh-999");
  assert.equal(ident?.userId, u.id);
});

test("no link and no matching email provisions a new user + link", async () => {
  const profile = normalizeExternalProfile("github", {
    sub: "gh-new",
    email: "newcomer@x.io",
    login: "newcomer",
    name: "New Comer",
  });
  const res = await resolveOrProvisionGitHubUser(profile);
  assert.equal(res.created, true);
  assert.equal(res.linked, true);
  const created = await getUserByEmail("newcomer@x.io");
  assert.ok(created);
  assert.equal(res.userId, created!.id);
  const ident = await findUserByExternalId("github", "gh-new");
  assert.equal(ident?.userId, created!.id);
});

test("UNIQUE(provider,sub) prevents one external id mapping to two users", async () => {
  const u1 = createUserSync({ role: "user", email: "a@x.io" });
  await linkExternalIdentity({ provider: "github", sub: "shared", userId: u1.id, email: "a@x.io" });
  // Attempt to link the same external id to a different user must fail.
  await assert.rejects(
    () =>
      linkExternalIdentity({
        provider: "github",
        sub: "shared",
        userId: "other-user",
        email: "b@x.io",
      }),
    /unique/i
  );
});

test("getExternalIdentitiesForUser lists only that user's links", async () => {
  const u = createUserSync({ role: "user", email: "multi@x.io" });
  await linkExternalIdentity({
    provider: "github",
    sub: "gh-a",
    userId: u.id,
    email: "multi@x.io",
  });
  const idents = await getExternalIdentitiesForUser(u.id);
  assert.equal(idents.length, 1);
  assert.equal(idents[0].sub, "gh-a");
});
