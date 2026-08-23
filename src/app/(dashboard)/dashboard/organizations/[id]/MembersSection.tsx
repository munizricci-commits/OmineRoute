"use client";

import { useState, useEffect, useCallback } from "react";
import { changeMemberRole, fetchMembers, inviteMember, removeMember } from "../apiClient";
import type { OrgRole, OrganizationMember } from "../types";
import RoleBadge from "../components/RoleBadge";

const inputClass =
  "mt-1 w-full rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-main)] outline-none focus:border-[var(--color-accent)]";

export default function MembersSection({
  orgId,
  viewerRole,
}: {
  orgId: string;
  viewerRole: OrgRole;
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("user");
  const [inviting, setInviting] = useState(false);

  const canManage = viewerRole === "owner" || viewerRole === "moderator";
  const canChangeRole = viewerRole === "owner";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await fetchMembers(orgId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !canManage) return;
    setInviting(true);
    setActionError(null);
    try {
      await inviteMember(orgId, { email: email.trim(), role: inviteRole });
      setEmail("");
      setInviteRole("user");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to invite member");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setActionError(null);
    try {
      await removeMember(orgId, userId);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleRole = async (userId: string, action: "promote" | "demote") => {
    setActionError(null);
    try {
      await changeMemberRole(orgId, userId, action);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to change role");
    }
  };

  return (
    <div className="space-y-4">
      {/* Invite */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text-main)] mb-3">Invite member</h2>
        {!canManage ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Only owners and moderators can invite members.
          </p>
        ) : (
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <label className="block">
                <span className="text-xs text-[var(--color-text-muted)]">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-text-muted)]">Role</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className={inputClass}
                >
                  <option value="user">user</option>
                  <option value="moderator">moderator</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={inviting || !email.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {inviting ? "Inviting…" : "Invite"}
              </button>
            </div>
            {actionError && <p className="text-xs text-red-400">{actionError}</p>}
          </form>
        )}
      </div>

      {/* Members list */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
        {loading ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">Loading…</div>
        ) : members.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[var(--color-text-muted)]">No members found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {members.map((m) => {
                const isOwner = m.role === "owner";
                return (
                  <tr key={m.id}>
                    <td className="px-5 py-3 text-[var(--color-text-main)] font-mono text-xs">
                      {m.userId}
                    </td>
                    <td className="px-5 py-3">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {canChangeRole && !isOwner && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRole(m.userId, "promote")}
                            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-main)] hover:bg-[var(--color-bg-alt)] mr-1"
                          >
                            Promote
                          </button>
                          {m.role === "moderator" && (
                            <button
                              type="button"
                              onClick={() => handleRole(m.userId, "demote")}
                              className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-main)] hover:bg-[var(--color-bg-alt)] mr-1"
                            >
                              Demote
                            </button>
                          )}
                        </>
                      )}
                      {canManage && !isOwner && (
                        <button
                          type="button"
                          onClick={() => handleRemove(m.userId)}
                          className="text-xs px-2 py-1 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
