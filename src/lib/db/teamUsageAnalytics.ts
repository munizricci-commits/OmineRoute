import { getDbInstance } from "./core";
import { calculateCost } from "@/lib/usage/costCalculator";
import { toNumber } from "@/shared/utils/numeric";

export interface TeamUsageReport {
  teamId: string;
  range: { startIso: string | null; endIso: string | null };
  enforcementMode: "soft_committed_usage";
  summary: {
    requests: number;
    successfulRequests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedListCostUsd: number;
    actualProviderCostUsd: null;
    subscriptionQuotaUsed: null;
    compressionSavingsUsd: null;
  };
  byApiKey: Array<{
    apiKeyId: string;
    apiKeyName: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedListCostUsd: number;
  }>;
}

type TeamUsageCostRow = {
  apiKeyId: string;
  apiKeyName: string | null;
  provider: string;
  model: string;
  serviceTier: string;
  requests: number;
  successfulRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
};

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function rowCost(row: TeamUsageCostRow): Promise<number> {
  return calculateCost(
    row.provider,
    row.model,
    {
      input: toNumber(row.inputTokens),
      output: toNumber(row.outputTokens),
      cacheRead: toNumber(row.cacheReadTokens),
      cacheCreation: toNumber(row.cacheCreationTokens),
      reasoning: toNumber(row.reasoningTokens),
    },
    { provider: row.provider, model: row.model, serviceTier: row.serviceTier }
  );
}

export async function getTeamUsageReport(
  teamId: string,
  options: { startIso?: string | null; endIso?: string | null } = {}
): Promise<TeamUsageReport> {
  const db = getDbInstance();
  const bind = {
    teamId,
    startIso: options.startIso || "0000-01-01T00:00:00.000Z",
    endIso: options.endIso || "9999-12-31T23:59:59.999Z",
    completeSummaryStartDate: (() => {
      const start = options.startIso;
      if (!start) return "0000-01-01";
      const date = start.slice(0, 10);
      return start === `${date}T00:00:00.000Z`
        ? date
        : new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
    })(),
    completeSummaryEndDateExclusive: (() => {
      const end = options.endIso;
      if (!end) return "9999-12-31";
      const date = end.slice(0, 10);
      return end === `${date}T23:59:59.999Z`
        ? new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
        : date;
    })(),
  };

  const rawRows = db
    .prepare(
      `SELECT
         COALESCE(NULLIF(api_key_id, ''), 'unknown') as apiKeyId,
         MAX(NULLIF(api_key_name, '')) as apiKeyName,
         LOWER(provider) as provider,
         LOWER(model) as model,
         COALESCE(NULLIF(service_tier, ''), 'standard') as serviceTier,
         COUNT(*) as requests,
         COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) as successfulRequests,
         COALESCE(SUM(tokens_input), 0) as inputTokens,
         COALESCE(SUM(tokens_output), 0) as outputTokens,
         COALESCE(SUM(tokens_cache_read), 0) as cacheReadTokens,
         COALESCE(SUM(tokens_cache_creation), 0) as cacheCreationTokens,
         COALESCE(SUM(tokens_reasoning), 0) as reasoningTokens
       FROM usage_history
       WHERE billing_team_id = @teamId
         AND team_rollup_processed_at IS NULL
         AND timestamp >= @startIso AND timestamp <= @endIso
       GROUP BY apiKeyId, LOWER(provider), LOWER(model), serviceTier`
    )
    .all(bind) as TeamUsageCostRow[];

  const summaryRows = db
    .prepare(
      `SELECT
         api_key_id as apiKeyId,
         MAX(NULLIF(api_key_name, '')) as apiKeyName,
         LOWER(provider) as provider,
         LOWER(model) as model,
         COALESCE(NULLIF(service_tier, ''), 'standard') as serviceTier,
         COALESCE(SUM(total_requests), 0) as requests,
         COALESCE(SUM(successful_requests), 0) as successfulRequests,
         COALESCE(SUM(total_input_tokens), 0) as inputTokens,
         COALESCE(SUM(total_output_tokens), 0) as outputTokens,
         COALESCE(SUM(total_cache_read_tokens), 0) as cacheReadTokens,
         COALESCE(SUM(total_cache_creation_tokens), 0) as cacheCreationTokens,
         COALESCE(SUM(total_reasoning_tokens), 0) as reasoningTokens
       FROM daily_team_usage_summary
       WHERE team_id = @teamId
         AND date >= @completeSummaryStartDate
         AND date < @completeSummaryEndDateExclusive
       GROUP BY api_key_id, LOWER(provider), LOWER(model), serviceTier`
    )
    .all(bind) as TeamUsageCostRow[];

  const rows = [...rawRows, ...summaryRows];
  const byKey = new Map<
    string,
    {
      apiKeyId: string;
      apiKeyName: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedListCostUsd: number;
    }
  >();
  let requests = 0;
  let successfulRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedListCostUsd = 0;

  for (const row of rows) {
    const cost = await rowCost(row);
    requests += toNumber(row.requests);
    successfulRequests += toNumber(row.successfulRequests);
    inputTokens += toNumber(row.inputTokens);
    outputTokens += toNumber(row.outputTokens);
    estimatedListCostUsd += cost;
    const current = byKey.get(row.apiKeyId) || {
      apiKeyId: row.apiKeyId,
      apiKeyName: row.apiKeyName || row.apiKeyId,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedListCostUsd: 0,
    };
    current.requests += toNumber(row.requests);
    current.inputTokens += toNumber(row.inputTokens);
    current.outputTokens += toNumber(row.outputTokens);
    current.estimatedListCostUsd += cost;
    byKey.set(row.apiKeyId, current);
  }

  return {
    teamId,
    range: { startIso: options.startIso || null, endIso: options.endIso || null },
    enforcementMode: "soft_committed_usage",
    summary: {
      requests,
      successfulRequests,
      inputTokens,
      outputTokens,
      estimatedListCostUsd: roundUsd(estimatedListCostUsd),
      actualProviderCostUsd: null,
      subscriptionQuotaUsed: null,
      compressionSavingsUsd: null,
    },
    byApiKey: [...byKey.values()]
      .map((row) => ({ ...row, estimatedListCostUsd: roundUsd(row.estimatedListCostUsd) }))
      .sort((left, right) => right.estimatedListCostUsd - left.estimatedListCostUsd),
  };
}
