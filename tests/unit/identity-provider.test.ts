/**
 * 08-github-oauth / Task 01 — minimal identity-provider contract.
 *
 * TDD: fails before lib/auth/identityProvider.ts exists, then passes. Defines the
 * minimal shape external authentication (GitHub OAuth here, extendable later)
 * must satisfy so the rest of the auth layer stays provider-agnostic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  type OAuthProviderConfig,
  type ExternalUserProfile,
  normalizeExternalProfile,
  isConfigured,
} from "../../src/lib/auth/identityProvider.ts";

test("OAuthProviderConfig requires client id, secret and callback", () => {
  const cfg: OAuthProviderConfig = {
    provider: "github",
    clientId: "abc",
    clientSecret: "secret",
    redirectUri: "https://x.io/callback",
    enabled: true,
  };
  assert.equal(cfg.provider, "github");
  assert.equal(cfg.enabled, true);
});

test("normalizeExternalProfile lowercases email and keeps sub", () => {
  const profile: ExternalUserProfile = normalizeExternalProfile("github", {
    sub: "12345",
    email: "User@GitHub.com",
    login: "octocat",
    name: "Octo Cat",
  });
  assert.equal(profile.sub, "12345");
  assert.equal(profile.email, "user@github.com");
  assert.equal(profile.provider, "github");
  assert.equal(profile.preferredUsername, "octocat");
});

test("isConfigured is false when disabled or missing secrets", () => {
  assert.equal(
    isConfigured({
      provider: "github",
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      enabled: false,
    }),
    false
  );
  assert.equal(
    isConfigured({
      provider: "github",
      clientId: "abc",
      clientSecret: "secret",
      redirectUri: "https://x.io/cb",
      enabled: true,
    }),
    true
  );
});
