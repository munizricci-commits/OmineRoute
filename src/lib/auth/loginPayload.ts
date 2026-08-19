/**
 * Pure login-payload builder (Task 05).
 *
 * Keeps the management-password flow intact: `password` is always required.
 * `login` is optional — when supplied (trimmed, non-empty) it is sent so the
 * server can bind the session to a resolved user; when omitted the legacy
 * session is used. No secrets are transformed here.
 */
export interface LoginPayload {
  password: string;
  login?: string;
}

export function buildLoginPayload(password: string, login?: string): LoginPayload {
  const payload: LoginPayload = { password };
  const normalized = (login ?? "").trim();
  if (normalized.length > 0) {
    payload.login = normalized;
  }
  return payload;
}
