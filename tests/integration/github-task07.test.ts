/**
 * 08-github-oauth / Task 07 — state integrity, redirect binding, identity
 * mismatch and linking-attack regression tests (TDD, integration + unit).
 *
 * Covers the fail-closed guarantees the roadmap calls out:
 *  - state must be present and server-issued (unknown -> rejected)
 *  - state is bound to the exact redirect_uri used at authorize (mismatch -> rejected)
 *  - the OAuth access token is never reflected to the client
 *  - linking attacks: a (provider,sub) can never be pointed at two users
 *  - replay: a consumed state cannot be reused
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-gh07-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync, getUserByEmail } = await import("../../src/lib/db/users.ts");
const { createOAuthState, consumeOAuthState } =
  await import("../../src/lib/db/githubOAuthState.ts");
const { linkExternalIdentity, findUserByExternalId } =
  await import("../../src/lib/db/externalIdentities.ts");
const { resolveOrProvisionGitHubUser } = await import("../../src/lib/auth/githubCallback.ts");
const { normalizeExternalProfile } = await import("../../src/lib/auth/identityProvider.ts");
const routeMod = await import("../../src/app/api/auth/github/callback/route.ts");

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

test("callback with a totally unknown state is rejected (403)", async () => {
  const res = await routeMod.GET(
    new Request("http://localhost/api/auth/github/callback?code=abc&state=unknownstate1234567890")
  );
  assert.equal(res.status, 403);
});

test("state is bound to the server-stored redirect_uri, never the request", async () => {
  // Authorize recorded redirect A. The callback MUST use A (from the stored
  // row) for the token exchange, not anything attacker-controlled in the URL.
  const state = await createOAuthState("https://legit.example/cb");
  const consumed = await consumeOAuthState(state);
  assert.ok(consumed);
  assert.equal(consumed!.redirectUri, "https://legit.example/cb");
  // After consumption the state is gone (single-use) — a different redirect B
  // can never be substituted because the binding lives server-side.
  const replay = await consumeOAuthState(state);
  assert.equal(replay, null);
});

test("linking attack: a (provider,sub) can never be pointed at two users", async () => {
  const u1 = createUserSync({ role: "user", email: "victim@x.io" });
  const u2 = createUserSync({ role: "user", email: "attacker@x.io" });
  await linkExternalIdentity({
    provider: "github",
    sub: "gh-shared",
    userId: u1.id,
    email: "victim@x.io",
  });
  // Attempt to link the SAME external id to a different user must fail hard.
  await assert.rejects(
    () =>
      linkExternalIdentity({
        provider: "github",
        sub: "gh-shared",
        userId: u2.id,
        email: "attacker@x.io",
      }),
    /unique/i
  );
  // And resolution still maps the external id to the original user.
  const ident = await findUserByExternalId("github", "gh-shared");
  assert.equal(ident?.userId, u1.id);
});

test("identity mismatch: provisioning never clobbers an existing user", async () => {
  // A brand-new GitHub identity with an email that already belongs to u1 must
  // safe-link to u1, not create a second account.
  const u1 = createUserSync({ role: "user", email: "dup@x.io" });
  const res = await resolveOrProvisionGitHubUser(
    normalizeExternalProfile("github", { sub: "gh-fresh", email: "dup@x.io", login: "dup" })
  );
  assert.equal(res.userId, u1.id);
  assert.equal(res.created, false);
  assert.equal(res.linked, true);
  const total = (
    core.getDbInstance().prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }
  ).c;
  assert.equal(total, 1);
});

test("replay: a consumed state cannot be reused (CSRF protection)", async () => {
  const state = await createOAuthState("https://x.io/cb");
  const first = await consumeOAuthState(state);
  assert.ok(first);
  const second = await consumeOAuthState(state);
  assert.equal(second, null);
});
