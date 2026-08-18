import type { OrgRole } from "../types";

const STYLES: Record<OrgRole, string> = {
  owner: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  moderator: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  user: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export default function RoleBadge({ role }: { role: OrgRole }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${STYLES[role]}`}>{role}</span>;
}
