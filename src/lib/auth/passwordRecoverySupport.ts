/**
 * auth/passwordRecoverySupport.ts — decide whether password recovery is meaningful.
 *
 * Recovery (forgot-password / reset-password) only applies when the instance runs
 * in multi-user mode: that is the mode where per-user accounts with emails exist
 * and a user can actually lose/reset their own password. In the legacy
 * single management-password mode there is no per-user password to recover, so
 * the entry point must stay hidden to avoid a dead/confusing flow.
 */

export interface RecoverySupportSettings {
  multi_user_enabled?: boolean | number;
}

export function isPasswordRecoverySupported(
  settings: RecoverySupportSettings | null | undefined
): boolean {
  if (!settings) return false;
  const v = settings.multi_user_enabled;
  return v === true || v === 1;
}
