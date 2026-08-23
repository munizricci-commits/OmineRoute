/**
 * GET /api/auth/github/callback
 *
 * GitHub OAuth redirect target. Validates the CSRF `state`, exchanges `code` for an
 * access token, fetches the GitHub profile, resolves/ provisions the local user
 * (safe-link rules), then issues a dashboard session. Fails closed on any mismatch.
 */

import { NextResponse } from "next/server";
import { getGithubOAuthConfig, getGithubOAuthSecret } from "@/lib/db/githubOAuthConfig";
import { consumeOAuthState } from "@/lib/db/githubOAuthState";
import { normalizeExternalProfile } from "@/lib/auth/identityProvider";
import { resolveOrProvisionGitHubUser } from "@/lib/auth/githubCallback";
import { issueAuthSession } from "@/lib/auth/sessionIssuer";
import { getAuditRequestContext, logAuditEvent } from "@/lib/compliance/index";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export async function GET(request: Request) {
  const auditContext = getAuditRequestContext(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "oauth_error", error },
    });
    return NextResponse.redirect(
      new URL("/login?oauth_error=" + encodeURIComponent(error), request.url)
    );
  }
  if (!code || !state) {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "missing_code_or_state" },
    });
    return NextResponse.json(buildErrorBody("bad_request", "Missing code or state"), {
      status: 400,
    });
  }

  // 1) State must be a previously issued, unexpired, single-use token.
  const stateRecord = await consumeOAuthState(state);
  if (!stateRecord) {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "invalid_or_expired_state" },
    });
    return NextResponse.json(buildErrorBody("forbidden", "Invalid or expired OAuth state"), {
      status: 403,
    });
  }

  // 2) Exchange code for an access token (uses the decrypted client secret).
  const cfg = await getGithubOAuthConfig();
  const secret = await getGithubOAuthSecret();
  if (!cfg.clientId || !secret) {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "oauth_not_configured" },
    });
    return NextResponse.json(buildErrorBody("bad_request", "GitHub OAuth not configured"), {
      status: 400,
    });
  }

  let accessToken: string;
  try {
    accessToken = await exchangeGithubCode({
      clientId: cfg.clientId,
      clientSecret: secret,
      redirectUri: stateRecord.redirectUri,
      code,
    });
  } catch {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "token_exchange_failed" },
    });
    return NextResponse.json(buildErrorBody("bad_gateway", "GitHub token exchange failed"), {
      status: 502,
    });
  }

  // 3) Fetch the GitHub profile.
  let profile: ExternalUserProfileLike;
  try {
    profile = await fetchGithubProfile(accessToken);
  } catch {
    logAuditEvent({
      action: "auth.github.callback",
      actor: "anonymous",
      target: "dashboard-auth",
      resourceType: "auth_session",
      status: "failed",
      ipAddress: auditContext.ipAddress || undefined,
      requestId: auditContext.requestId,
      metadata: { reason: "profile_fetch_failed" },
    });
    return NextResponse.json(buildErrorBody("bad_gateway", "GitHub profile fetch failed"), {
      status: 502,
    });
  }

  const normalized = normalizeExternalProfile("github", {
    sub: String(profile.id),
    email: profile.email,
    login: profile.login,
    name: profile.name,
  });

  // 4) Resolve / provision the local user (safe-link rules) + issue a session.
  const result = await resolveOrProvisionGitHubUser(normalized);
  const token = await issueAuthSession({ subject: result.userId });

  logAuditEvent({
    action: "auth.github.callback",
    actor: result.userId,
    target: "dashboard-auth",
    resourceType: "auth_session",
    status: "success",
    ipAddress: auditContext.ipAddress || undefined,
    requestId: auditContext.requestId,
    metadata: { created: result.created, linked: result.linked },
  });

  return NextResponse.redirect(new URL("/dashboard?oauth=success", request.url));
}

interface ExternalUserProfileLike {
  id: number | string;
  email: string | null;
  login: string | null;
  name: string | null;
}

/** Exchange the authorization code for an access token at GitHub. Pure HTTP. */
export async function exchangeGithubCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(data.error || "no access_token");
  return data.access_token;
}

/** Fetch the authenticated GitHub user profile. */
export async function fetchGithubProfile(accessToken: string): Promise<ExternalUserProfileLike> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "OmniRoute",
    },
  });
  if (!res.ok) throw new Error(`GitHub user fetch HTTP ${res.status}`);
  const data = await res.json();
  // Best-effort primary email when /user omits it.
  let email = data.email as string | null;
  if (!email) {
    try {
      const emRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      if (emRes.ok) {
        const emails = (await emRes.json()) as Array<{
          email: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified) ?? emails[0];
        email = primary?.email ?? null;
      }
    } catch {
      /* email optional */
    }
  }
  return { id: data.id, email, login: data.login ?? null, name: data.name ?? null };
}
