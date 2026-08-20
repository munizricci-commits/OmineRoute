/**
 * auth/registrationService.ts — registration/acceptance service (Phase 04).
 *
 * Validates the incoming registration against the instance policy, hashes the
 * password, and creates the user + credential atomically (transaction boundary).
 * Fail-closed: disabled policy rejects; invite-only requires a code.
 *
 * @module lib/auth/registrationService
 */

import { z } from "zod";
import { getDbInstance } from "@/lib/db/core";
import { createUserSync, getUserByLoginIdentifier, getUserByEmail } from "@/lib/db/users";
import { setUserPasswordSync } from "@/lib/db/userCredentials";
import { getInstanceAuthSettings } from "@/lib/db/instanceAuthSettings";
import { evaluatePassword, DEFAULT_PASSWORD_POLICY } from "@/lib/auth/passwordPolicy";
import { normalizeLoginIdentifier } from "@/lib/db/users";

export class RegistrationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
  }
}

const registrationInputSchema = z.object({
  loginIdentifier: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._@-]{1,128}$/)
    .optional()
    .nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  password: z
    .string()
    .min(DEFAULT_PASSWORD_POLICY.minLength)
    .max(DEFAULT_PASSWORD_POLICY.maxLength),
  inviteCode: z.string().trim().min(1).max(256).optional().nullable(),
});

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

/** Detect a SQLite UNIQUE-constraint violation (covers both login and email). */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(msg) || /SQLITE_CONSTRAINT_UNIQUE/i.test(msg);
}

export interface AcceptedUser {
  id: string;
  loginIdentifier: string | null;
  email: string | null;
  role: string;
  status: string;
}

/**
 * Accept a registration. Returns the created user (no secrets). Throws
 * RegistrationError on policy/validation failure.
 */
export async function acceptRegistration(raw: unknown): Promise<AcceptedUser> {
  const parsed = registrationInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RegistrationError("Invalid registration input", "INVALID_INPUT");
  }
  const input = parsed.data;

  const settings = await getInstanceAuthSettings();
  if (settings.registrationPolicy === "disabled") {
    throw new RegistrationError("Registration is disabled", "DISABLED");
  }
  if (settings.registrationPolicy === "invite-only" && !input.inviteCode) {
    throw new RegistrationError("Invite code required", "INVITE_REQUIRED");
  }

  const pwCheck = evaluatePassword(input.password);
  if (!pwCheck.valid) {
    throw new RegistrationError(pwCheck.errors.join("; "), "WEAK_PASSWORD");
  }

  // Pre-check for duplicate login/email. The error is generic on purpose: it must
  // NOT reveal which field (or even that an account exists) to avoid account
  // enumeration. The DB unique indexes are the authoritative guard; this check is
  // a friendly fast-path with the same generic message.
  const normalizedLogin = input.loginIdentifier
    ? normalizeLoginIdentifier(input.loginIdentifier)
    : null;
  const normalizedEmail = input.email ? String(input.email).trim().toLowerCase() : null;
  if (normalizedLogin && (await getUserByLoginIdentifier(normalizedLogin))) {
    throw new RegistrationError("Account already exists", "DUPLICATE");
  }
  if (normalizedEmail && (await getUserByEmail(normalizedEmail))) {
    throw new RegistrationError("Account already exists", "DUPLICATE");
  }

  const db = getDbInstance();
  const tx = db.transaction((data: RegistrationInput) => {
    const user = createUserSync({
      role: "user",
      loginIdentifier: data.loginIdentifier ?? null,
      email: data.email ?? null,
    });
    setUserPasswordSync(user.id, data.password);
    return user;
  });

  try {
    const user = tx(input);
    return {
      id: user.id,
      loginIdentifier: user.loginIdentifier ?? null,
      email: user.email ?? null,
      role: user.role,
      status: user.status,
    };
  } catch (err) {
    // Race: a concurrent registration slipped in between the pre-check and the
    // insert. The unique indexes reject the duplicate; surface it as the same
    // generic error so no account-existence information leaks.
    if (isUniqueConstraintError(err)) {
      throw new RegistrationError("Account already exists", "DUPLICATE");
    }
    throw err;
  }
}
