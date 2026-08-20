/**
 * auth/githubCallback.ts — GitHub OAuth callback identity resolution
 * (Phase 08, Task 04).
 *
 * Pure resolution logic (no HTTP): given a normalized GitHub profile, decide
 * which local user the OAuth identity maps to, applying the account-linking
 * rules:
 *  - existing external link -> log in as that user (no new account)
 *  - no link but matching verified email -> safe-link to existing user
 *  - no link and no match -> provision a new user + link
 *
 * The UNIQUE(provider, sub) constraint (db/externalIdentities.ts) is the
 * backstop that prevents one external id from mapping to two users.
 */

import { ExternalUserProfile } from "./identityProvider";
import { createUserSync } from "@/lib/db/users";
import { findUserByExternalId, linkExternalIdentity } from "@/lib/db/externalIdentities";

export interface ResolveGitHubUserResult {
  userId: string;
  /** True when a brand-new local user was provisioned. */
  created: boolean;
  /** True when a new external->user link was created. */
  linked: boolean;
}

export async function resolveOrProvisionGitHubUser(
  profile: ExternalUserProfile
): Promise<ResolveGitHubUserResult> {
  if (profile.provider !== "github") {
    throw new Error("Unsupported OAuth provider for account resolution");
  }

  // 1) Existing external link wins (idempotent login).
  const existingLink = await findUserByExternalId(profile.provider, profile.sub);
  if (existingLink) {
    return { userId: existingLink.userId, created: false, linked: false };
  }

  // 2) No link yet: if a local user already owns the verified email, safe-link.
  if (profile.email) {
    const { getUserByEmail } = await import("@/lib/db/users");
    const byEmail = await getUserByEmail(profile.email);
    if (byEmail) {
      await linkExternalIdentity({
        provider: profile.provider,
        sub: profile.sub,
        userId: byEmail.id,
        email: profile.email,
      });
      return { userId: byEmail.id, created: false, linked: true };
    }
  }

  // 3) Provision a new local user and link the external identity.
  const user = createUserSync({
    role: "user",
    email: profile.email,
    displayName: profile.name,
    loginIdentifier: profile.preferredUsername,
  });
  await linkExternalIdentity({
    provider: profile.provider,
    sub: profile.sub,
    userId: user.id,
    email: profile.email,
  });
  return { userId: user.id, created: true, linked: true };
}
