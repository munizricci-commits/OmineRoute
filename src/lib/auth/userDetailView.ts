/**
 * Pure formatting for the user detail view (Task 04). Maps raw membership rows to a
 * compact, UI-friendly representation. No secrets.
 */
export interface MembershipViewInput {
  organizationId: string;
  role: string;
  status: string;
}

export function formatMemberships(memberships: MembershipViewInput[]): string[] {
  if (!memberships || memberships.length === 0) return [];
  return memberships.map((m) => `${m.role}@${m.organizationId} (${m.status})`);
}
