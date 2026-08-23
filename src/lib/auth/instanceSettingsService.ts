/**
 * auth/instanceSettingsService.ts — platform-admin-gated access to instance auth
 * settings (Phase 02). Pure/testable; the route layer resolves the principal and
 * passes the resolved user here. Authorization is fail-closed: a non-admin user is
 * rejected before any settings read or write.
 *
 * @module lib/auth/instanceSettingsService
 */

import type { UserRecord } from "@/lib/db/users";
import { isPlatformAdmin } from "@/lib/org/principal";
import {
  getInstanceAuthSettings,
  setInstanceAuthSettings,
  type InstanceAuthSettings,
  type SetInstanceAuthSettingsInput,
} from "@/lib/db/instanceAuthSettings";

/** Thrown when a non-platform-admin attempts a platform-admin-only operation. */
export class PlatformAdminRequiredError extends Error {
  constructor(message = "Platform administrator access required") {
    super(message);
    this.name = "PlatformAdminRequiredError";
  }
}

function assertPlatformAdmin(user: UserRecord | null | undefined): asserts user is UserRecord {
  if (!user || !isPlatformAdmin(user)) {
    throw new PlatformAdminRequiredError();
  }
}

/** Read instance auth settings. Platform-admin only. */
export async function getAuthSettingsForAdmin(
  user: UserRecord | null | undefined
): Promise<InstanceAuthSettings> {
  assertPlatformAdmin(user);
  return getInstanceAuthSettings();
}

/** Update instance auth settings. Platform-admin only. */
export async function updateAuthSettingsForAdmin(
  user: UserRecord | null | undefined,
  input: SetInstanceAuthSettingsInput
): Promise<InstanceAuthSettings> {
  assertPlatformAdmin(user);
  return setInstanceAuthSettings(input);
}
