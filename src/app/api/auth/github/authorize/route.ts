/**
 * GET /api/auth/github/authorize
 *
 * Initiate GitHub OAuth login. Mints a single-use, expiring CSRF `state`
 * (stored server-side) and returns the GitHub authorize URL carrying it.
 * Refuses when OAuth is unconfigured (fails closed).
 */

import { NextResponse } from "next/server";
import { beginGithubAuthorization, GithubOAuthError } from "@/lib/auth/githubAuthorize";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const redirectUri = searchParams.get("redirect_uri") ?? undefined;
    const result = await beginGithubAuthorization({ redirectUri });
    return NextResponse.json({
      authorizeUrl: result.authorizeUrl,
      state: result.state,
    });
  } catch (err) {
    if (err instanceof GithubOAuthError) {
      return NextResponse.json(buildErrorBody("bad_request", err.message), { status: 400 });
    }
    return NextResponse.json(buildErrorBody("bad_request", "GitHub OAuth unavailable"), {
      status: 400,
    });
  }
}
