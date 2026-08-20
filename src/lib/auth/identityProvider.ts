/**
 * auth/identityProvider.ts — minimal identity-provider contract (Phase 08, Task 01).
 *
 * Defines the smallest shape external authentication must satisfy so the rest of
 * the auth layer (login, account linking, session issuance) stays provider
 * agnostic. GitHub OAuth is the first implementation; the contract is deliberately
 * narrow so additional providers can be added without touching call sites.
 */

export type OAuthProviderId = "github";

export interface OAuthProviderConfig {
  provider: OAuthProviderId;
  clientId: string;
  /** Persisted encrypted at rest; never returned in plaintext by readers. */
  clientSecret: string;
  redirectUri: string;
  enabled: boolean;
}

export interface ExternalUserProfileInput {
  sub: string;
  email?: string | null;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface ExternalUserProfile {
  provider: OAuthProviderId;
  sub: string;
  email: string | null;
  preferredUsername: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/** Normalize a raw provider profile into the canonical external profile shape. */
export function normalizeExternalProfile(
  provider: OAuthProviderId,
  raw: ExternalUserProfileInput
): ExternalUserProfile {
  return {
    provider,
    sub: String(raw.sub),
    email: raw.email ? raw.email.trim().toLowerCase() : null,
    preferredUsername: raw.login ?? null,
    name: raw.name ?? null,
    avatarUrl: raw.avatarUrl ?? null,
  };
}

/** True only when the provider is enabled and has the minimum credentials. */
export function isConfigured(cfg: OAuthProviderConfig): boolean {
  return (
    cfg.enabled &&
    cfg.clientId.trim().length > 0 &&
    cfg.clientSecret.trim().length > 0 &&
    cfg.redirectUri.trim().length > 0
  );
}

/** Stable, unique account key for a given external identity (provider-scoped). */
export function externalAccountKey(provider: OAuthProviderId, sub: string): string {
  return `${provider}:${sub}`;
}
