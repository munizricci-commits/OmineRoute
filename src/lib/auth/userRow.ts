/**
 * Pure normalization for a user summary row shown in the admin Users table (Task 02).
 * Guarantees a display label even when displayName is absent.
 */
export interface UserSummaryInput {
  id: string;
  email: string | null;
  displayName: string | null;
  loginIdentifier: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function userSummaryLabel(u: UserSummaryInput): string {
  return u.displayName?.trim() || u.loginIdentifier?.trim() || u.email?.trim() || u.id;
}
