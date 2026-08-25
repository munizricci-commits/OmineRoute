import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-team-management-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "team-management-test-secret";

const core = await import("../../src/lib/db/core.ts");
const apiKeys = await import("../../src/lib/db/apiKeys.ts");
const teams = await import("../../src/lib/db/teams.ts");
const usageHistory = await import("../../src/lib/usage/usageHistory.ts");
const aggregateHistory = await import("../../src/lib/usage/aggregateHistory.ts");
const localDb = await import("../../src/lib/localDb.ts");
const teamBudgets = await import("../../src/lib/usage/teamUsageLimits.ts");
const teamAnalytics = await import("../../src/lib/db/teamUsageAnalytics.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeys.resetApiKeyState();
  usageHistory.clearPendingRequests();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);
test.after(() => {
  core.resetDbInstance();
  apiKeys.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration 163 creates team cost-center schema and immutable usage attribution", () => {
  const db = core.getDbInstance();
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name)
  );
  assert.ok(tables.has("teams"));
  assert.ok(tables.has("api_key_billing_team_history"));
  assert.ok(tables.has("daily_team_usage_summary"));
  const usageColumns = new Set(
    (db.prepare("PRAGMA table_info(usage_history)").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  assert.ok(usageColumns.has("billing_team_id"));
});

test("an API key has one active billing team while ACL groups remain independent", async () => {
  const key = await apiKeys.createApiKey("agent-a", "machine-team-01");
  const alpha = teams.createTeam({ name: "Alpha" });
  const beta = teams.createTeam({ name: "Beta" });

  teams.assignApiKeyBillingTeam(key.id, alpha.id, "2026-08-14T10:00:00.000Z");
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T11:00:00.000Z");

  assert.equal(teams.getActiveBillingTeamForApiKey(key.id)?.id, beta.id);
  assert.deepEqual(
    teams.listApiKeyBillingHistory(key.id).map((row) => [row.teamId, row.validFrom, row.validTo]),
    [
      [alpha.id, "2026-08-14T10:00:00.000Z", "2026-08-14T11:00:00.000Z"],
      [beta.id, "2026-08-14T11:00:00.000Z", null],
    ]
  );
  assert.deepEqual(teams.listTeamMembers(alpha.id), []);
  assert.equal(teams.listTeamMembers(beta.id)[0]?.apiKeyId, key.id);
});

test("unassigning through the wrong team cannot close another team's active binding", async () => {
  const key = await apiKeys.createApiKey("agent-scope", "machine-team-scope");
  const alpha = teams.createTeam({ name: "Scope Alpha" });
  const beta = teams.createTeam({ name: "Scope Beta" });
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T10:00:00.000Z");

  assert.equal(
    teams.unassignApiKeyBillingTeam(key.id, "2026-08-14T11:00:00.000Z", alpha.id),
    false
  );
  assert.equal(teams.getActiveBillingTeamForApiKey(key.id)?.id, beta.id);
});

test("usage snapshots the billing team and a later transfer does not rewrite history", async () => {
  const key = await apiKeys.createApiKey("agent-b", "machine-team-02");
  const alpha = teams.createTeam({ name: "Alpha usage" });
  const beta = teams.createTeam({ name: "Beta usage" });
  teams.assignApiKeyBillingTeam(key.id, alpha.id, "2026-08-14T11:00:00.000Z");

  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 10, output: 5 },
    timestamp: "2026-08-14T12:00:00.000Z",
  });
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T12:30:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 20, output: 10 },
    timestamp: "2026-08-14T13:00:00.000Z",
  });

  const rows = core
    .getDbInstance()
    .prepare("SELECT billing_team_id FROM usage_history ORDER BY timestamp")
    .all() as Array<{ billing_team_id: string | null }>;
  assert.deepEqual(
    rows.map((row) => row.billing_team_id),
    [alpha.id, beta.id]
  );
});

test("retention rollup preserves the team dimension and all billable token classes", async () => {
  const key = await apiKeys.createApiKey("agent-c", "machine-team-03");
  const team = teams.createTeam({ name: "Rollup team" });
  teams.assignApiKeyBillingTeam(key.id, team.id, "2025-12-31T00:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "claude",
    model: "claude-test",
    serviceTier: "priority",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 100, output: 50, cacheRead: 20, cacheCreation: 10, reasoning: 5 },
    timestamp: "2026-01-01T12:00:00.000Z",
  });

  const result = await aggregateHistory.rollupUsageHistoryBeforeDate("2026-01-02");
  assert.equal(result.errors, 0);
  const row = core
    .getDbInstance()
    .prepare("SELECT * FROM daily_team_usage_summary WHERE team_id = ?")
    .get(team.id) as Record<string, unknown>;
  assert.equal(row.total_requests, 1);
  assert.equal(row.total_input_tokens, 100);
  assert.equal(row.total_output_tokens, 50);
  assert.equal(row.total_cache_read_tokens, 20);
  assert.equal(row.total_cache_creation_tokens, 10);
  assert.equal(row.total_reasoning_tokens, 5);
  assert.equal(row.service_tier, "priority");
});

test("team shared budget uses committed estimated list cost and is explicit about soft enforcement", async () => {
  await localDb.updatePricing({
    openai: {
      "gpt-team-budget": { input: 1, cached: 1, output: 1, reasoning: 1, cache_creation: 1 },
    },
  });
  const key = await apiKeys.createApiKey("agent-d", "machine-team-04");
  const team = teams.createTeam({
    name: "Budget team",
    maxBudgetUsd: 1,
    budgetDuration: "1d",
  });
  const now = new Date();
  teams.assignApiKeyBillingTeam(key.id, team.id, new Date(now.getTime() - 1_000).toISOString());
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-team-budget",
    apiKeyId: key.id,
    apiKeyName: key.name,
    billingTeamId: team.id,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: now.toISOString(),
  });

  const status = await teamBudgets.getTeamUsageLimitStatusForApiKey(key.id);
  assert.ok(status);
  assert.equal(status?.enforcementMode, "soft_committed_usage");
  assert.equal(status?.estimatedListCostUsd, 1);
  assert.equal(status?.actualProviderCostUsd, null);
  assert.equal(status?.exceeded, true);

  const rejection = await teamBudgets.buildTeamUsageLimitPolicyRejection(
    new Request("http://localhost/v1/messages", { headers: { "anthropic-version": "2023-06-01" } }),
    key.id
  );
  assert.equal(rejection?.status, 400);
  assert.match(JSON.stringify(await rejection?.json()), /team.*usage quota/i);
});

test("a non-budget update advances an expired budget window instead of resetting its cadence", async () => {
  const team = teams.createTeam({
    name: "Stable cadence team",
    maxBudgetUsd: 5,
    budgetDuration: "7d",
  });
  const staleResetAt = "2026-01-08T00:00:00.000Z";
  core
    .getDbInstance()
    .prepare("UPDATE teams SET budget_reset_at = ? WHERE id = ?")
    .run(staleResetAt, team.id);

  const updated = teams.updateTeam(team.id, { description: "metadata only" });
  assert.ok(updated?.budgetResetAt);
  assert.ok(Date.parse(updated.budgetResetAt) > Date.now());
  assert.notEqual(updated.budgetResetAt, staleResetAt);
  assert.equal(updated.description, "metadata only");
});

test("soft budget excludes rolled-up UTC buckets that only partially overlap the rolling window", async () => {
  await localDb.updatePricing({
    openai: {
      "gpt-team-boundary": { input: 1, cached: 1, output: 1, reasoning: 1 },
    },
  });
  const key = await apiKeys.createApiKey("agent-boundary", "machine-team-boundary");
  const team = teams.createTeam({
    name: "Boundary budget team",
    maxBudgetUsd: 1,
    budgetDuration: "1d",
  });
  teams.assignApiKeyBillingTeam(key.id, team.id);
  const db = core.getDbInstance();
  db.prepare("UPDATE teams SET budget_reset_at = ? WHERE id = ?").run(
    "2026-08-15T12:00:00.000Z",
    team.id
  );
  db.prepare(
    `INSERT INTO daily_team_usage_summary (
      team_id, api_key_id, provider, model, service_tier, date,
      total_requests, successful_requests, total_input_tokens, successful_input_tokens
    ) VALUES (?, ?, ?, ?, 'standard', ?, 1, 1, 1000000, 1000000)`
  ).run(team.id, key.id, "openai", "gpt-team-boundary", "2026-08-14");

  const status = await teamBudgets.getTeamUsageLimitStatusForApiKey(
    key.id,
    Date.parse("2026-08-15T11:00:00.000Z")
  );
  assert.equal(status?.windowStartIso, "2026-08-14T12:00:00.000Z");
  assert.equal(status?.estimatedListCostUsd, 0);
  assert.equal(status?.exceeded, false);
});

test("team usage reports do not charge rolled-up partial boundary days", async () => {
  await localDb.updatePricing({
    openai: {
      "gpt-team-report-boundary": { input: 1, cached: 1, output: 1, reasoning: 1 },
    },
  });
  const key = await apiKeys.createApiKey("agent-report", "machine-team-report");
  const team = teams.createTeam({ name: "Boundary report team" });
  teams.assignApiKeyBillingTeam(key.id, team.id);
  core
    .getDbInstance()
    .prepare(
      `INSERT INTO daily_team_usage_summary (
        team_id, api_key_id, provider, model, service_tier, date,
        total_requests, successful_requests, total_input_tokens, successful_input_tokens
      ) VALUES (?, ?, ?, ?, 'standard', ?, 1, 1, 1000000, 1000000)`
    )
    .run(team.id, key.id, "openai", "gpt-team-report-boundary", "2026-08-14");

  const partial = await teamAnalytics.getTeamUsageReport(team.id, {
    startIso: "2026-08-14T12:00:00.000Z",
    endIso: "2026-08-15T12:00:00.000Z",
  });
  assert.equal(partial.summary.requests, 0);

  const full = await teamAnalytics.getTeamUsageReport(team.id, {
    startIso: "2026-08-14T00:00:00.000Z",
    endIso: "2026-08-14T23:59:59.999Z",
  });
  assert.equal(full.summary.requests, 1);
  assert.equal(full.summary.estimatedListCostUsd, 1);
});

test("JSON export/import preserves teams, temporal billing bindings, and usage snapshots", async () => {
  const key = await apiKeys.createApiKey("agent-json", "machine-team-json");
  const team = teams.createTeam({ name: "JSON Team", maxBudgetUsd: 3, budgetDuration: "7d" });
  teams.assignApiKeyBillingTeam(key.id, team.id, "2026-08-10T00:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-json",
    apiKeyId: key.id,
    apiKeyName: key.name,
    billingTeamId: team.id,
    tokens: { input: 3, output: 2 },
    timestamp: "2026-08-11T00:00:00.000Z",
  });

  const db = core.getDbInstance();
  const exported = {
    apiKeys: db.prepare("SELECT * FROM api_keys WHERE id = ?").all(key.id),
    teams: teams.listTeams({ includeArchived: true }),
    apiKeyBillingTeamHistory: teams.listAllApiKeyBillingHistory(),
    usageHistory: db.prepare("SELECT * FROM usage_history WHERE api_key_id = ?").all(key.id),
    dailyTeamUsageSummary: [
      {
        team_id: team.id,
        api_key_id: key.id,
        provider: "openai",
        model: "gpt-json",
        service_tier: "priority",
        date: "2026-08-10",
        total_requests: 2,
        successful_requests: 2,
        total_input_tokens: 8,
        successful_input_tokens: 8,
      },
    ],
  };
  db.prepare("DELETE FROM usage_history").run();
  db.prepare("DELETE FROM api_key_billing_team_history").run();
  db.prepare("DELETE FROM teams").run();
  db.prepare("DELETE FROM api_keys WHERE id = ?").run(key.id);

  const jsonMigration = await import("../../src/lib/db/jsonMigration.ts");
  const counts = jsonMigration.runJsonMigration(db, exported as never);
  assert.equal(counts.teams, 1);
  assert.equal(counts.apiKeyBillingTeamHistory, 1);
  assert.equal(counts.dailyTeamUsageSummary, 1);
  assert.equal(teams.getActiveBillingTeamForApiKey(key.id)?.id, team.id);
  const usage = db
    .prepare("SELECT billing_team_id FROM usage_history WHERE api_key_id = ?")
    .get(key.id) as { billing_team_id: string };
  assert.equal(usage.billing_team_id, team.id);
  const summary = db
    .prepare("SELECT service_tier, total_requests FROM daily_team_usage_summary WHERE team_id = ?")
    .get(team.id) as { service_tier: string; total_requests: number };
  assert.deepEqual(summary, { service_tier: "priority", total_requests: 2 });
});

test("archiving a team closes active assignments but preserves historical usage", async () => {
  const key = await apiKeys.createApiKey("agent-e", "machine-team-05");
  const team = teams.createTeam({ name: "Archive team" });
  teams.assignApiKeyBillingTeam(key.id, team.id, "2026-08-14T14:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    billingTeamId: team.id,
    tokens: { input: 1 },
    timestamp: "2026-08-14T14:30:00.000Z",
  });

  const archived = teams.archiveTeam(team.id, "2026-08-14T15:00:00.000Z");
  assert.equal(archived?.status, "archived");
  assert.equal(teams.getActiveBillingTeamForApiKey(key.id), null);
  const count = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) as count FROM usage_history WHERE billing_team_id = ?")
    .get(team.id) as { count: number };
  assert.equal(count.count, 1);
});
