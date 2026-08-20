/**
 * auth/passwordPolicy.ts — password policy evaluation (Phase 04, Task 04).
 *
 * Pure, dependency-free evaluation of a candidate password against the instance
 * password policy. Used by registration and credential-setting paths so the same
 * rules apply everywhere. No I/O; safe to unit test in isolation.
 *
 * @module lib/auth/passwordPolicy
 */

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  /** Lowercased passwords that are never accepted (trivial/common values). */
  denylist: string[];
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 200,
  denylist: [
    "password",
    "12345678",
    "omniroute",
    "qwerty123",
    "administrator",
    "letmein",
    "changeme",
  ],
};

export interface PasswordEvaluation {
  valid: boolean;
  errors: string[];
}

/**
 * Evaluate a candidate password. Returns a list of human-readable errors; `valid`
 * is true only when the list is empty. Always trims before checking so whitespace
 * padding cannot smuggle a trivial value through.
 */
export function evaluatePassword(
  raw: unknown,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY
): PasswordEvaluation {
  const errors: string[] = [];

  if (typeof raw !== "string") {
    return { valid: false, errors: ["Password must be a string"] };
  }

  const pw = raw.trim();

  if (pw.length === 0) {
    return { valid: false, errors: ["Password is required"] };
  }
  if (pw.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (pw.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters`);
  }
  if (policy.denylist.includes(pw.toLowerCase())) {
    errors.push("Password is too common or trivial");
  }

  return { valid: errors.length === 0, errors };
}
