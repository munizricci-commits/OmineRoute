/**
 * apiClient.ts — Thin, typed fetch wrappers for the Organizations REST API
 * (P8.01). Client-safe (no server imports). All methods throw `Error` with a
 * sanitized message on non-2xx responses; the caller decides how to surface it.
 *
 * @module app/(dashboard)/dashboard/organizations/apiClient
 */

import type {
  OrgRole,
  OrganizationCombo,
  OrganizationConnection,
  OrganizationDetail,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
  WrappedItem,
  WrappedList,
} from "./types";

/** Extract a human-readable message from a non-2xx JSON error body. */
async function parseError(res: Response): Promise<Error> {
  let message = `Request failed (${res.status})`;
  try {
    const raw: unknown = await res.json();
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const msg = obj.message;
      if (typeof msg === "string" && msg.length > 0) {
        message = msg;
      } else {
        const err = obj.error;
        if (typeof err === "string" && err.length > 0) message = err;
      }
    }
  } catch {
    // keep the status-based fallback message
  }
  return new Error(message);
}

/** GET a list endpoint and return the unwrapped `data` array. */
async function getList<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as WrappedList<T>;
  return Array.isArray(body.data) ? body.data : [];
}

/** Send a JSON body to an endpoint and return the parsed (unwrapped) response. */
async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

// ── Organizations (P8.02) ───────────────────────────────────────────────────

export async function fetchOrganizations(): Promise<OrganizationSummary[]> {
  return getList<OrganizationSummary>("/api/v1/organizations");
}

export async function createOrganization(input: {
  name: string;
  slug: string;
}): Promise<OrganizationSummary> {
  const res = await sendJson<WrappedItem<OrganizationSummary>>(
    "/api/v1/organizations",
    "POST",
    input
  );
  return res.data;
}

/** GET a single organization (returns viewer role via the `role` field). */
export async function fetchOrganization(id: string): Promise<OrganizationDetail> {
  const res = await fetch(`/api/v1/organizations/${id}`);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as WrappedItem<OrganizationSummary>;
  return { ...body.data, role: body.role ?? "user" };
}

// ── Members (P8.03) ─────────────────────────────────────────────────────────

export async function fetchMembers(id: string): Promise<OrganizationMember[]> {
  return getList<OrganizationMember>(`/api/v1/organizations/${id}/members`);
}

export async function inviteMember(
  id: string,
  input: { email: string; role?: OrgRole }
): Promise<OrganizationInvitation> {
  const res = await sendJson<WrappedItem<OrganizationInvitation>>(
    `/api/v1/organizations/${id}/invitations`,
    "POST",
    input
  );
  return res.data;
}

export async function removeMember(id: string, userId: string): Promise<void> {
  const res = await fetch(`/api/v1/organizations/${id}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await parseError(res);
}

export async function changeMemberRole(
  id: string,
  userId: string,
  action: "promote" | "demote"
): Promise<OrganizationMember> {
  const res = await sendJson<WrappedItem<OrganizationMember>>(
    `/api/v1/organizations/${id}/members/${userId}`,
    "PATCH",
    { action }
  );
  return res.data;
}

// ── Connections + combos (P8.04 / P8.05 / P8.06) ────────────────────────────

export async function fetchConnections(id: string): Promise<OrganizationConnection[]> {
  return getList<OrganizationConnection>(`/api/v1/organizations/${id}/connections`);
}

export async function fetchCombos(id: string): Promise<OrganizationCombo[]> {
  return getList<OrganizationCombo>(`/api/v1/organizations/${id}/combos`);
}
