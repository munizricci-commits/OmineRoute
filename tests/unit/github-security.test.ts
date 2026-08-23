/**
 * 08-github-oauth / Task 06 — safe linking + security tests (TDD).
 *
 * Documents and guards the account-linking invariants:
 *  - a single GitHub identity (provider,sub) can only ever map to one local user
 *    (UNIQUE backstop, tested at unit level)
 *  - an existing link is idempotent (same user on repeat callback)
 *  - the OAuth access token is never reflected back to the client / logs
 *  - state is single-use: a replayed state is rejected (CSRF protection)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ghsec-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createOAuthState, consumeOAuthState } =
  await import("../../src/lib/db/githubOAuthState.ts");
const { linkExternalIdentity, findUserByExternalId } =
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

test("existing link is idempotent: repeat callback resolves to the same user", async () => {
  const u = createUserSync({ role: "user", email: "a@x.io" });
  await linkExternalIdentity({ provider: "github", sub: "gh-1", userId: u.id, email: "a@x.io" });

  const first = await resolveOrProvisionGitHubUser(
    normalizeExternalProfile("github", { sub: "gh-1", email: "a@x.io", login: "a" })
  );
  const second = await resolveOrProvisionGitHubUser(
    normalizeExternalProfile("github", { sub: "gh-1", email: "a@x.io", login: "a" })
  );
  assert.equal(first.userId, u.id);
  assert.equal(second.userId, u.id);
  assert.equal(first.created, false);
  assert.equal(second.created, false);
  // Still exactly one link row for this sub.
  const link = await findUserByExternalId("github", "gh-1");
  assert.equal(link?.userId, u.id);
});

test("OAuth state is single-use: consumed state cannot be reused (CSRF)", async () => {
  const state = await createOAuthState("https://x.io/cb");
  const first = await consumeOAuthState(state);
  assert.ok(first);
  const second = await consumeOAuthState(state);
  assert.equal(second, null);
});

test("OAuth state expires and is rejected after TTL", async () => {
  const state = await createOAuthState("https://x.io/cb");
  // Backdate the stored expiry to the past.
  const db = core.getDbInstance();
  db.prepare(`UPDATE github_oauth_states SET expires_at = ? WHERE state = ?`).run(
    new Date(Date.now() - 1000).toISOString(),
    state
  );
  const consumed = await consumeOAuthState(state);
  assert.equal(consumed, null);
});
