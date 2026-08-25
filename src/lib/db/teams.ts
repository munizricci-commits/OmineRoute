import { getDbInstance } from "./core";

export type TeamStatus = "active" | "archived";
export type TeamBudgetDuration = "1d" | "7d" | "30d";

export interface Team {
  id: string;
  name: string;
  description: string;
  status: TeamStatus;
  maxBudgetUsd: number | null;
  budgetDuration: TeamBudgetDuration | null;
  budgetResetAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TeamCreateInput {
  name: string;
  description?: string;
  maxBudgetUsd?: number | null;
  budgetDuration?: TeamBudgetDuration | null;
}

export interface TeamUpdateInput {
  name?: string;
  description?: string;
  maxBudgetUsd?: number | null;
  budgetDuration?: TeamBudgetDuration | null;
}

export interface ApiKeyBillingTeamHistory {
  id: string;
  apiKeyId: string;
  teamId: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

export interface TeamMember {
  apiKeyId: string;
  apiKeyName: string;
  assignedAt: string;
}

type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  status: TeamStatus;
  max_budget_usd: number | null;
  budget_duration: TeamBudgetDuration | null;
  budget_reset_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type BillingRow = {
  id: string;
  api_key_id: string;
  team_id: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

const BUDGET_DURATION_MS: Record<TeamBudgetDuration, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const CONCURRENT_ASSIGNMENT_ERROR =
  "API key billing team changed concurrently; retry the assignment";

function normalizeIso(value: string | undefined = undefined): string {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid effective timestamp");
  return date.toISOString();
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("Team name is required");
  if (name.length > 200) throw new Error("Team name must be at most 200 characters");
  return name;
}

function normalizeBudget(
  input: {
    maxBudgetUsd?: number | null;
    budgetDuration?: TeamBudgetDuration | null;
  },
  nowIso: string
): {
  maxBudgetUsd: number | null;
  budgetDuration: TeamBudgetDuration | null;
  budgetResetAt: string | null;
} {
  const hasBudget = input.maxBudgetUsd !== undefined || input.budgetDuration !== undefined;
  if (!hasBudget) {
    return { maxBudgetUsd: null, budgetDuration: null, budgetResetAt: null };
  }
  if (input.maxBudgetUsd == null && input.budgetDuration == null) {
    return { maxBudgetUsd: null, budgetDuration: null, budgetResetAt: null };
  }
  const amount = Number(input.maxBudgetUsd);
  const duration = input.budgetDuration;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("maxBudgetUsd must be greater than zero");
  }
  if (!duration || !(duration in BUDGET_DURATION_MS)) {
    throw new Error("budgetDuration must be one of 1d, 7d, or 30d");
  }
  return {
    maxBudgetUsd: amount,
    budgetDuration: duration,
    budgetResetAt: new Date(Date.parse(nowIso) + BUDGET_DURATION_MS[duration]).toISOString(),
  };
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    status: row.status,
    maxBudgetUsd: row.max_budget_usd,
    budgetDuration: row.budget_duration,
    budgetResetAt: row.budget_reset_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function rowToBillingHistory(row: BillingRow): ApiKeyBillingTeamHistory {
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    teamId: row.team_id,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at,
  };
}

export function createTeam(input: TeamCreateInput): Team {
  const db = getDbInstance();
  const now = new Date().toISOString();
  const budget = normalizeBudget(input, now);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO teams (
      id, name, description, status, max_budget_usd, budget_duration,
      budget_reset_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalizeName(input.name),
    input.description?.trim() || "",
    budget.maxBudgetUsd,
    budget.budgetDuration,
    budget.budgetResetAt,
    now,
    now
  );
  return getTeam(id)!;
}

export function listTeams(options: { includeArchived?: boolean } = {}): Team[] {
  const db = getDbInstance();
  const rows = options.includeArchived
    ? (db.prepare("SELECT * FROM teams ORDER BY created_at ASC").all() as TeamRow[])
    : (db
        .prepare("SELECT * FROM teams WHERE status = 'active' ORDER BY created_at ASC")
        .all() as TeamRow[]);
  return rows.map(rowToTeam);
}

export function getTeam(id: string): Team | null {
  const row = getDbInstance().prepare("SELECT * FROM teams WHERE id = ?").get(id) as
    TeamRow | undefined;
  return row ? rowToTeam(row) : null;
}

export function updateTeam(id: string, input: TeamUpdateInput): Team | null {
  const db = getDbInstance();
  const existing = getTeam(id);
  if (!existing) return null;
  if (existing.status !== "active") throw new Error("Archived teams cannot be updated");

  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = @updatedAt"];
  const params: Record<string, unknown> = { id, updatedAt: now };
  if (input.name !== undefined) {
    updates.push("name = @name");
    params.name = normalizeName(input.name);
  }
  if (input.description !== undefined) {
    updates.push("description = @description");
    params.description = input.description.trim();
  }
  if (input.maxBudgetUsd !== undefined || input.budgetDuration !== undefined) {
    const budget = normalizeBudget(
      {
        maxBudgetUsd: input.maxBudgetUsd !== undefined ? input.maxBudgetUsd : existing.maxBudgetUsd,
        budgetDuration:
          input.budgetDuration !== undefined ? input.budgetDuration : existing.budgetDuration,
      },
      now
    );
    updates.push(
      "max_budget_usd = @maxBudgetUsd",
      "budget_duration = @budgetDuration",
      "budget_reset_at = @budgetResetAt"
    );
    params.maxBudgetUsd = budget.maxBudgetUsd;
    params.budgetDuration = budget.budgetDuration;
    params.budgetResetAt = budget.budgetResetAt;
  }
  db.prepare(`UPDATE teams SET ${updates.join(", ")} WHERE id = @id`).run(params);
  const updated = getTeam(id);
  if (updated?.maxBudgetUsd && updated.budgetDuration && updated.budgetResetAt) {
    advanceTeamBudgetWindow(updated, Date.now());
  }
  return getTeam(id);
}

export function archiveTeam(id: string, archivedAt?: string): Team | null {
  const db = getDbInstance();
  const team = getTeam(id);
  if (!team) return null;
  if (team.status === "archived") return team;
  const when = normalizeIso(archivedAt);
  const archive = db.transaction(() => {
    // Close every still-open binding of this team. `valid_to` must satisfy the
    // migration-161 CHECK (valid_to IS NULL OR valid_to > valid_from), which a
    // same-instant archive would violate: a key assigned in the same millisecond
    // the team is archived has valid_from === when. Archiving is an unconditional
    // administrative action with no client-supplied timestamp, so rejecting it
    // would turn an internal clock-granularity collision into a spurious 500 and
    // leave the team active. Clamp the degenerate interval to valid_from + 1ms
    // instead, keeping the interval non-empty and the archive effective.
    const open = db
      .prepare(
        "SELECT id, valid_from FROM api_key_billing_team_history WHERE team_id = ? AND valid_to IS NULL"
      )
      .all(id) as { id: string; valid_from: string }[];
    const close = db.prepare(
      "UPDATE api_key_billing_team_history SET valid_to = ? WHERE id = ? AND valid_to IS NULL"
    );
    for (const binding of open) {
      const validTo =
        when > binding.valid_from
          ? when
          : new Date(new Date(binding.valid_from).getTime() + 1).toISOString();
      close.run(validTo, binding.id);
    }
    db.prepare(
      `UPDATE teams
       SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(when, when, id);
  });
  archive();
  return getTeam(id);
}

export function assignApiKeyBillingTeam(
  apiKeyId: string,
  teamId: string,
  effectiveAt?: string
): ApiKeyBillingTeamHistory {
  const db = getDbInstance();
  const when = normalizeIso(effectiveAt);
  let result: ApiKeyBillingTeamHistory | null = null;

  const assign = db.transaction(() => {
    const team = db.prepare("SELECT status FROM teams WHERE id = ?").get(teamId) as
      { status: TeamStatus } | undefined;
    if (!team) throw new Error("Team not found");
    if (team.status !== "active") throw new Error("Cannot assign an API key to an archived team");
    const key = db.prepare("SELECT id FROM api_keys WHERE id = ?").get(apiKeyId);
    if (!key) throw new Error("API key not found");

    const current = db
      .prepare(
        "SELECT * FROM api_key_billing_team_history WHERE api_key_id = ? AND valid_to IS NULL"
      )
      .get(apiKeyId) as BillingRow | undefined;
    if (current?.team_id === teamId) {
      result = rowToBillingHistory(current);
      return;
    }
    if (current) {
      if (when <= current.valid_from) {
        throw new Error("Assignment time must be after the active assignment start");
      }
      const closed = db
        .prepare(
          "UPDATE api_key_billing_team_history SET valid_to = ? WHERE id = ? AND valid_to IS NULL"
        )
        .run(when, current.id);
      if (closed.changes !== 1) throw new Error(CONCURRENT_ASSIGNMENT_ERROR);
    }

    const row: BillingRow = {
      id: crypto.randomUUID(),
      api_key_id: apiKeyId,
      team_id: teamId,
      valid_from: when,
      valid_to: null,
      created_at: when,
    };
    try {
      db.prepare(
        `INSERT INTO api_key_billing_team_history
          (id, api_key_id, team_id, valid_from, valid_to, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).run(row.id, row.api_key_id, row.team_id, row.valid_from, row.created_at);
    } catch (error) {
      if (/unique constraint/i.test(error instanceof Error ? error.message : "")) {
        throw new Error(CONCURRENT_ASSIGNMENT_ERROR);
      }
      throw error;
    }
    result = rowToBillingHistory(row);
  });
  assign();
  return result!;
}

export function unassignApiKeyBillingTeam(
  apiKeyId: string,
  effectiveAt?: string,
  expectedTeamId?: string
): boolean {
  const db = getDbInstance();
  const when = normalizeIso(effectiveAt);
  const current = db
    .prepare(
      "SELECT id, team_id, valid_from FROM api_key_billing_team_history WHERE api_key_id = ? AND valid_to IS NULL"
    )
    .get(apiKeyId) as { id: string; team_id: string; valid_from: string } | undefined;
  if (!current || (expectedTeamId && current.team_id !== expectedTeamId)) return false;
  if (when <= current.valid_from)
    throw new Error("Unassignment time must be after assignment start");
  return (
    db
      .prepare(
        "UPDATE api_key_billing_team_history SET valid_to = ? WHERE id = ? AND valid_to IS NULL"
      )
      .run(when, current.id).changes > 0
  );
}

export function getActiveBillingTeamForApiKey(apiKeyId: string): Team | null {
  const row = getDbInstance()
    .prepare(
      `SELECT teams.*
       FROM api_key_billing_team_history binding
       JOIN teams ON teams.id = binding.team_id
       WHERE binding.api_key_id = ? AND binding.valid_to IS NULL AND teams.status = 'active'`
    )
    .get(apiKeyId) as TeamRow | undefined;
  return row ? rowToTeam(row) : null;
}

export function resolveBillingTeamIdForApiKeyAt(
  apiKeyId: string | null | undefined,
  at: string
): string | null {
  if (!apiKeyId) return null;
  const row = getDbInstance()
    .prepare(
      `SELECT team_id
       FROM api_key_billing_team_history
       WHERE api_key_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
       ORDER BY valid_from DESC LIMIT 1`
    )
    .get(apiKeyId, at, at) as { team_id: string } | undefined;
  return row?.team_id ?? null;
}

export function listApiKeyBillingHistory(apiKeyId: string): ApiKeyBillingTeamHistory[] {
  return (
    getDbInstance()
      .prepare(
        "SELECT * FROM api_key_billing_team_history WHERE api_key_id = ? ORDER BY valid_from ASC"
      )
      .all(apiKeyId) as BillingRow[]
  ).map(rowToBillingHistory);
}

export function listAllApiKeyBillingHistory(): ApiKeyBillingTeamHistory[] {
  return (
    getDbInstance()
      .prepare("SELECT * FROM api_key_billing_team_history ORDER BY valid_from ASC")
      .all() as BillingRow[]
  ).map(rowToBillingHistory);
}

export function listTeamMembers(teamId: string): TeamMember[] {
  return getDbInstance()
    .prepare(
      `SELECT binding.api_key_id as apiKeyId, api_keys.name as apiKeyName,
              binding.valid_from as assignedAt
       FROM api_key_billing_team_history binding
       JOIN api_keys ON api_keys.id = binding.api_key_id
       WHERE binding.team_id = ? AND binding.valid_to IS NULL
       ORDER BY api_keys.name COLLATE NOCASE ASC`
    )
    .all(teamId) as TeamMember[];
}

export function advanceTeamBudgetWindow(team: Team, nowMs = Date.now()): Team {
  if (!team.maxBudgetUsd || !team.budgetDuration || !team.budgetResetAt) return team;
  const durationMs = BUDGET_DURATION_MS[team.budgetDuration];
  let resetAtMs = Date.parse(team.budgetResetAt);
  if (!Number.isFinite(resetAtMs)) throw new Error("Team budget reset metadata is invalid");
  if (resetAtMs > nowMs) return team;
  const elapsedWindows = Math.floor((nowMs - resetAtMs) / durationMs) + 1;
  resetAtMs += elapsedWindows * durationMs;
  const nextReset = new Date(resetAtMs).toISOString();
  const updatedAt = new Date(nowMs).toISOString();
  const result = getDbInstance()
    .prepare(
      `UPDATE teams
       SET budget_reset_at = ?, updated_at = ?
       WHERE id = ? AND budget_reset_at = ?`
    )
    .run(nextReset, updatedAt, team.id, team.budgetResetAt);
  if (result.changes !== 1) return getTeam(team.id) ?? team;
  return { ...team, budgetResetAt: nextReset, updatedAt };
}

export function getTeamBudgetWindowStart(team: Team): string | null {
  if (!team.budgetDuration || !team.budgetResetAt) return null;
  return new Date(
    Date.parse(team.budgetResetAt) - BUDGET_DURATION_MS[team.budgetDuration]
  ).toISOString();
}
