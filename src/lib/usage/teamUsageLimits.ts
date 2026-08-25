import { getDbInstance } from "@/lib/db/core";
import {
  advanceTeamBudgetWindow,
  getActiveBillingTeamForApiKey,
  getTeamBudgetWindowStart,
} from "@/lib/db/teams";
import { calculateCost } from "./costCalculator";
import { buildErrorBody, sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
import { toNumber } from "@/shared/utils/numeric";

export interface TeamUsageLimitStatus {
  teamId: string;
  teamName: string;
  enforcementMode: "soft_committed_usage";
  maxBudgetUsd: number;
  budgetDuration: "1d" | "7d" | "30d";
  windowStartIso: string;
  resetAtIso: string;
  estimatedListCostUsd: number;
  actualProviderCostUsd: null;
  subscriptionQuotaUsed: null;
  compressionSavingsUsd: null;
  exceeded: boolean;
}

type CostRow = {
  provider: string;
  model: string;
  serviceTier: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
};

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function calculateRows(rows: CostRow[]): Promise<number> {
  let total = 0;
  for (const row of rows) {
    if (!row.provider || !row.model) continue;
    total += await calculateCost(
      row.provider,
      row.model,
      {
        input: toNumber(row.inputTokens),
        output: toNumber(row.outputTokens),
        cacheRead: toNumber(row.cacheReadTokens),
        cacheCreation: toNumber(row.cacheCreationTokens),
        reasoning: toNumber(row.reasoningTokens),
      },
      { provider: row.provider, model: row.model, serviceTier: row.serviceTier || "standard" }
    );
  }
  return roundUsd(total);
}

async function getCommittedTeamEstimatedListCostUsd(
  teamId: string,
  windowStartIso: string,
  resetAtIso: string
): Promise<number> {
  const db = getDbInstance();
  const rawRows = db
    .prepare(
      `SELECT
         LOWER(provider) as provider,
         LOWER(model) as model,
         COALESCE(NULLIF(service_tier, ''), 'standard') as serviceTier,
         COALESCE(SUM(tokens_input), 0) as inputTokens,
         COALESCE(SUM(tokens_output), 0) as outputTokens,
         COALESCE(SUM(tokens_cache_read), 0) as cacheReadTokens,
         COALESCE(SUM(tokens_cache_creation), 0) as cacheCreationTokens,
         COALESCE(SUM(tokens_reasoning), 0) as reasoningTokens
       FROM usage_history
       WHERE billing_team_id = @teamId
         AND team_rollup_processed_at IS NULL
         AND timestamp >= @windowStartIso AND timestamp < @resetAtIso
         AND success = 1
       GROUP BY LOWER(provider), LOWER(model), serviceTier`
    )
    .all({ teamId, windowStartIso, resetAtIso }) as CostRow[];

  // Team budgets are rolling 1d/7d/30d windows. The durable rollup stores one
  // aggregate per UTC day, so a non-midnight boundary cannot be reconstructed
  // exactly after raw rows have been removed. Include only complete daily buckets
  // and intentionally undercount partial boundary days rather than charging usage
  // from outside the configured window. This keeps phase-1 soft enforcement honest.
  const windowStartDate = windowStartIso.slice(0, 10);
  const resetDate = resetAtIso.slice(0, 10);
  const summaryRows = db
    .prepare(
      `SELECT
         LOWER(provider) as provider,
         LOWER(model) as model,
         COALESCE(NULLIF(service_tier, ''), 'standard') as serviceTier,
         COALESCE(SUM(successful_input_tokens), 0) as inputTokens,
         COALESCE(SUM(successful_output_tokens), 0) as outputTokens,
         COALESCE(SUM(successful_cache_read_tokens), 0) as cacheReadTokens,
         COALESCE(SUM(successful_cache_creation_tokens), 0) as cacheCreationTokens,
         COALESCE(SUM(successful_reasoning_tokens), 0) as reasoningTokens
       FROM daily_team_usage_summary
       WHERE team_id = @teamId
         AND date >= @completeSummaryStartDate
         AND date < @completeSummaryEndDateExclusive
       GROUP BY LOWER(provider), LOWER(model), serviceTier`
    )
    .all({
      teamId,
      completeSummaryStartDate:
        windowStartIso === `${windowStartDate}T00:00:00.000Z`
          ? windowStartDate
          : new Date(Date.parse(`${windowStartDate}T00:00:00.000Z`) + 86_400_000)
              .toISOString()
              .slice(0, 10),
      completeSummaryEndDateExclusive: resetDate,
    }) as CostRow[];

  return roundUsd((await calculateRows(rawRows)) + (await calculateRows(summaryRows)));
}

export async function getTeamUsageLimitStatusForApiKey(
  apiKeyId: string,
  nowMs = Date.now()
): Promise<TeamUsageLimitStatus | null> {
  let team = getActiveBillingTeamForApiKey(apiKeyId);
  if (!team?.maxBudgetUsd || !team.budgetDuration || !team.budgetResetAt) return null;
  team = advanceTeamBudgetWindow(team, nowMs);
  const windowStartIso = getTeamBudgetWindowStart(team);
  if (!windowStartIso || !team.budgetResetAt) return null;
  const estimatedListCostUsd = await getCommittedTeamEstimatedListCostUsd(
    team.id,
    windowStartIso,
    team.budgetResetAt
  );
  return {
    teamId: team.id,
    teamName: team.name,
    enforcementMode: "soft_committed_usage",
    maxBudgetUsd: team.maxBudgetUsd,
    budgetDuration: team.budgetDuration,
    windowStartIso,
    resetAtIso: team.budgetResetAt,
    estimatedListCostUsd,
    actualProviderCostUsd: null,
    subscriptionQuotaUsed: null,
    compressionSavingsUsd: null,
    exceeded: estimatedListCostUsd >= team.maxBudgetUsd,
  };
}

function isAnthropicMessagesRequest(request: Request): boolean {
  if (request.headers.has("anthropic-version")) return true;
  try {
    return new URL(request.url).pathname.endsWith("/v1/messages");
  } catch {
    return false;
  }
}

export async function buildTeamUsageLimitPolicyRejection(
  request: Request,
  apiKeyId: string
): Promise<Response | null> {
  const status = await getTeamUsageLimitStatusForApiKey(apiKeyId);
  if (!status?.exceeded) return null;
  const message = sanitizeErrorMessage(
    `This API key's team reached its shared usage quota. The soft committed-usage window resets at ${status.resetAtIso}.`
  );
  if (isAnthropicMessagesRequest(request)) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response(JSON.stringify(buildErrorBody(400, message)), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
