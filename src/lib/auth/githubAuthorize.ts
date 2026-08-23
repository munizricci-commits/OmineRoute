/**
 * auth/githubAuthorize.ts — GitHub OAuth authorization initiation (Phase 08, Task 03).
 *
 * Builds the authorize URL and mints a single-use, expiring CSRF `state` stored
 * server-side (verified on callback). Refuses to start when OAuth is not
 * configured. Fails closed.
 */

import { getGithubOAuthConfig } from "@/lib/db/githubOAuthConfig";
import { createOAuthState, buildGithubAuthorizeUrl } from "@/lib/db/githubOAuthState";

export class GithubOAuthError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_CONFIGURED" | "INVALID_INPUT"
  ) {
    super(message);
    this.name = "GithubOAuthError";
  }
}

export interface BeginAuthorizationResult {
  state: string;
  authorizeUrl: string;
}

export async function beginGithubAuthorization(opts: {
  redirectUri?: string;
}): Promise<BeginAuthorizationResult> {
  const cfg = await getGithubOAuthConfig();
  if (!cfg.enabled || cfg.clientId.length === 0) {
    throw new GithubOAuthError("GitHub OAuth is not configured", "NOT_CONFIGURED");
  }
  const redirectUri = opts.redirectUri || cfg.redirectUri;
  if (!redirectUri) {
    throw new GithubOAuthError("Missing redirect URI", "INVALID_INPUT");
  }
  const state = await createOAuthState(redirectUri);
  const authorizeUrl = buildGithubAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri,
    state,
  });
  return { state, authorizeUrl };
}
