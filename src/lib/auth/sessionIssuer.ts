/**
 * auth/sessionIssuer.ts — issue a dashboard auth session cookie (Phase 08, Task 04).
 *
 * Thin wrapper around the same JWT+HttpOnly-cookie mechanism the management
 * login uses, so GitHub-OAuth and password sessions are interchangeable for the
 * dashboard principal. Kept dependency-free and reusable by OAuth callbacks.
 */

import { SignJWT } from "jose";
import { cookies } from "next/headers";

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET || "");
}

export interface IssueSessionOptions {
  subject: string;
  /** When false, omit the `sub` claim (legacy management-password session). */
  secureCookie?: boolean;
}

/**
 * Sign a session JWT bound to `subject` and set it on the auth_token cookie.
 * Returns the signed token (callers may also return it in the JSON body).
 */
export async function issueAuthSession(opts: IssueSessionOptions): Promise<string> {
  const claims: Record<string, unknown> = { authenticated: true, sub: opts.subject };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(getJwtSecret());

  const cookieStore = await cookies();
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: opts.secureCookie ?? false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}
