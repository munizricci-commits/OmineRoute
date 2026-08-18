/**
 * P3.04 (secret-boundary) — TDD.
 *
 * Proves the separation between "ability to USE a connection" and "ability to READ
 * its credential material":
 *  - owner / moderator of the owning org (or platform_admin override) → `full`,
 *  - an ordinary org member → `usable`,
 *  - a personal connection → `full` only for its own owner,
 *  - non-member / missing context → `usable` (never `full`),
 *  - `redactConnectionCredentials` strips apiKey/apiSecret/password/bearerToken
 *    when visibility is not `full` and leaves them when it is.
 */

import test from "node:test";
import assert from "node:assert/strict";

const authz = await import("../../src/lib/org/authorization.ts");
const types = await import("../../src/lib/org/types.ts");

const ownerCtx = { organizationId: "o1", role: "owner" as const };
const moderatorCtx = { organizationId: "o1", role: "moderator" as const };
const memberCtx = { organizationId: "o1", role: "user" as const };
const adminCtx = authz.platformAdminOrganizationContext("o1");

const orgConnection = { scope: "organization" as const, organizationId: "o1" };
const personalOwned = { scope: "personal" as const, ownerUserId: "u-self" };
const personalOther = { scope: "personal" as const, ownerUserId: "u-other" };

test("owner of the owning org gets full visibility", () => {
  assert.equal(authz.resolveConnectionVisibility(ownerCtx, "u-owner", orgConnection), "full");
});

test("moderator of the owning org gets full visibility", () => {
  assert.equal(authz.resolveConnectionVisibility(moderatorCtx, "u-mod", orgConnection), "full");
});

test("platform_admin override gets full visibility", () => {
  assert.equal(authz.resolveConnectionVisibility(adminCtx, "u-admin", orgConnection), "full");
});

test("ordinary member of the owning org gets usable (no creds) visibility", () => {
  assert.equal(authz.resolveConnectionVisibility(memberCtx, "u-member", orgConnection), "usable");
});

test("non-member / missing context gets usable visibility (fail-closed)", () => {
  assert.equal(authz.resolveConnectionVisibility(null, "u-x", orgConnection), "usable");
  assert.equal(
    authz.resolveConnectionVisibility(
      { organizationId: "o2", role: "owner" },
      "u-x",
      orgConnection
    ),
    "usable",
    "owner of a *different* org is not full on this org's connection"
  );
});

test("personal connection is full only for its own owner", () => {
  assert.equal(authz.resolveConnectionVisibility(null, "u-self", personalOwned), "full");
  assert.equal(
    authz.resolveConnectionVisibility(ownerCtx, "u-stranger", personalOther),
    "usable",
    "a non-owner (even an org owner) sees only usable on someone else's personal connection"
  );
});

test("redactConnectionCredentials strips credential fields when not full", () => {
  const conn = {
    id: "c1",
    name: "My Key",
    provider: "openai",
    apiKey: "sk-secret",
    accessToken: "at-secret",
    refreshToken: "rt-secret",
    idToken: "idt-secret",
  };
  const redacted = authz.redactConnectionCredentials(conn, "usable");
  assert.equal(redacted.id, "c1");
  assert.equal(redacted.name, "My Key");
  assert.equal(redacted.provider, "openai");
  assert.equal("apiKey" in redacted, false, "apiKey stripped");
  assert.equal("accessToken" in redacted, false, "accessToken stripped");
  assert.equal("refreshToken" in redacted, false, "refreshToken stripped");
  assert.equal("idToken" in redacted, false, "idToken stripped");
  // original is never mutated
  assert.equal(conn.apiKey, "sk-secret");
});

test("redactConnectionCredentials leaves credential fields when full", () => {
  const conn = {
    id: "c1",
    name: "My Key",
    provider: "openai",
    apiKey: "sk-secret",
    accessToken: "at-secret",
    refreshToken: "rt-secret",
    idToken: "idt-secret",
  };
  const full = authz.redactConnectionCredentials(conn, "full");
  assert.equal(full.apiKey, "sk-secret");
  assert.equal(full.accessToken, "at-secret");
  assert.equal(full.refreshToken, "rt-secret");
  assert.equal(full.idToken, "idt-secret");
});

test("redactConnectionCredentials strips a partial set of credential fields", () => {
  const conn = { id: "c1", apiKey: "sk-secret" };
  const redacted = authz.redactConnectionCredentials(conn, "usable");
  assert.equal("apiKey" in redacted, false);
  assert.equal(redacted.id, "c1");
});

test("ConnectionVisibility type is the usable|full union", () => {
  const v: types.ConnectionVisibility = "usable";
  assert.equal(v, "usable");
  const w: types.ConnectionVisibility = "full";
  assert.equal(w, "full");
});

test("P4.04 regression: real provider_connections credential fields are stripped (usable)", () => {
  // Mirrors a real row after rowToCamel: the credential columns are apiKey,
  // accessToken, refreshToken, idToken — NOT the old placeholder names.
  const conn = {
    id: "c-real",
    provider: "google",
    authType: "oauth",
    name: "Real OAuth",
    email: "a@b.com",
    apiKey: "sk-real",
    accessToken: "at-real",
    refreshToken: "rt-real",
    idToken: "idt-real",
    organizationId: "org-1",
  };
  const redacted = authz.redactConnectionCredentials(conn, "usable");
  assert.equal(redacted.id, "c-real");
  assert.equal(redacted.provider, "google");
  assert.equal(redacted.email, "a@b.com");
  assert.equal(redacted.organizationId, "org-1");
  assert.equal("apiKey" in redacted, false, "apiKey stripped");
  assert.equal("accessToken" in redacted, false, "accessToken stripped");
  assert.equal("refreshToken" in redacted, false, "refreshToken stripped");
  assert.equal("idToken" in redacted, false, "idToken stripped");
  // None of the old placeholder names ever existed on a real connection.
  assert.equal("apiSecret" in redacted, false);
  assert.equal("password" in redacted, false);
  assert.equal("bearerToken" in redacted, false);
});

test("P4.04 regression: real credential fields are preserved when full", () => {
  const conn = {
    id: "c-real",
    provider: "openai",
    apiKey: "sk-real",
    accessToken: "at-real",
    refreshToken: "rt-real",
    idToken: "idt-real",
  };
  const full = authz.redactConnectionCredentials(conn, "full");
  assert.equal(full.apiKey, "sk-real");
  assert.equal(full.accessToken, "at-real");
  assert.equal(full.refreshToken, "rt-real");
  assert.equal(full.idToken, "idt-real");
});
