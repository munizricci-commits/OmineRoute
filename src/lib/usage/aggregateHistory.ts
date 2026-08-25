/**
 * Aggregation utility functions for usage data summarization.
 * Rolls up usage_history (and quota_snapshots) into daily summary tables.
 *
 * @module lib/usage/aggregateHistory
 */

import { getDbInstance } from "../db/core";
import { getUserDatabaseSettings } from "../db/databaseSettings";

interface AggregationResult {
  processed: number;
  inserted: number;
  errors: number;
}

/**
 * Roll up quota_snapshots into daily_usage_summary table.
 * Aggregates by provider, model, and date.
 *
 * @param fromDate - Start date (YYYY-MM-DD format)
 * @param toDate - End date (YYYY-MM-DD format)
 * @returns Aggregation result with counts
 */
export async function rollupDailyUsage(
  fromDate: string,
  toDate: string
): Promise<AggregationResult> {
  const db = getDbInstance();

  const result: AggregationResult = {
    processed: 0,
    inserted: 0,
    errors: 0,
  };

  try {
    // Aggregate quota_snapshots by provider, model, and date
    const aggregateQuery = `
      INSERT INTO daily_usage_summary (provider, model, date, total_requests, total_input_tokens, total_output_tokens, total_cost)
      SELECT 
        provider,
        COALESCE(json_extract(raw_data, '$.model'), 'unknown') as model,
        DATE(created_at) as date,
        COUNT(*) as total_requests,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.input_tokens') AS INTEGER)), 0) as total_input_tokens,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.output_tokens') AS INTEGER)), 0) as total_output_tokens,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.cost') AS REAL)), 0.0) as total_cost
      FROM quota_snapshots
      WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
      GROUP BY provider, model, DATE(created_at)
      ON CONFLICT(provider, model, date) DO UPDATE SET
        total_requests = excluded.total_requests,
        total_input_tokens = excluded.total_input_tokens,
        total_output_tokens = excluded.total_output_tokens,
        total_cost = excluded.total_cost
    `;

    const stmt = db.prepare(aggregateQuery);
    const runResult = stmt.run(fromDate, toDate);

    result.processed = runResult.changes;
    result.inserted = runResult.changes;

    console.log(`[Aggregation] Daily rollup: ${result.inserted} rows for ${fromDate} to ${toDate}`);
  } catch (err: any) {
    console.error("[Aggregation] Daily rollup error:", err);
    result.errors++;
  }

  return result;
}

/**
 * Roll up quota_snapshots into hourly_usage_summary table.
 * Aggregates by provider, model, and hour.
 *
 * @param fromDate - Start datetime (YYYY-MM-DD HH:MM:SS format)
 * @param toDate - End datetime (YYYY-MM-DD HH:MM:SS format)
 * @returns Aggregation result with counts
 */
export async function rollupHourlyQuota(
  fromDate: string,
  toDate: string
): Promise<AggregationResult> {
  const db = getDbInstance();

  const result: AggregationResult = {
    processed: 0,
    inserted: 0,
    errors: 0,
  };

  try {
    // Aggregate quota_snapshots by provider, model, and hour
    const aggregateQuery = `
      INSERT INTO hourly_usage_summary (provider, model, date_hour, total_requests, total_input_tokens, total_output_tokens, total_cost)
      SELECT 
        provider,
        COALESCE(json_extract(raw_data, '$.model'), 'unknown') as model,
        datetime(strftime('%Y-%m-%d %H:00:00', created_at)) as date_hour,
        COUNT(*) as total_requests,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.input_tokens') AS INTEGER)), 0) as total_input_tokens,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.output_tokens') AS INTEGER)), 0) as total_output_tokens,
        COALESCE(SUM(CAST(json_extract(raw_data, '$.cost') AS REAL)), 0.0) as total_cost
      FROM quota_snapshots
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY provider, model, datetime(strftime('%Y-%m-%d %H:00:00', created_at))
      ON CONFLICT(provider, model, date_hour) DO UPDATE SET
        total_requests = excluded.total_requests,
        total_input_tokens = excluded.total_input_tokens,
        total_output_tokens = excluded.total_output_tokens,
        total_cost = excluded.total_cost
    `;

    const stmt = db.prepare(aggregateQuery);
    const runResult = stmt.run(fromDate, toDate);

    result.processed = runResult.changes;
    result.inserted = runResult.changes;

    console.log(
      `[Aggregation] Hourly rollup: ${result.inserted} rows for ${fromDate} to ${toDate}`
    );
  } catch (err: any) {
    console.error("[Aggregation] Hourly rollup error:", err);
    result.errors++;
  }

  return result;
}

/**
 * Roll up usage_history into daily_usage_summary before raw rows are deleted.
 * This is the authoritative rollup — sourced from actual per-request token data,
 * not from quota_snapshots. Should be called before cleanupUsageHistory() deletes rows.
 *
 * The ON CONFLICT clause uses SUM so re-running is additive-safe: if a date already
 * has a partial rollup (e.g. from a previous partial cleanup), new rows accumulate.
 *
 * @param beforeDate - ISO timestamp/date boundary. Rows strictly before this value are rolled up.
 * @returns Aggregation result with counts
 */
export async function rollupUsageHistoryBeforeDate(beforeDate: string): Promise<AggregationResult> {
  const db = getDbInstance();

  const result: AggregationResult = {
    processed: 0,
    inserted: 0,
    errors: 0,
  };

  try {
    const rollupStartedAt = new Date().toISOString();
    const teamAggregateQuery = `
      INSERT INTO daily_team_usage_summary (
        team_id, api_key_id, api_key_name, provider, model, service_tier, date,
        total_requests, successful_requests, total_input_tokens, total_output_tokens,
        total_cache_read_tokens, total_cache_creation_tokens, total_reasoning_tokens,
        successful_input_tokens, successful_output_tokens, successful_cache_read_tokens,
        successful_cache_creation_tokens, successful_reasoning_tokens
      )
      SELECT
        billing_team_id,
        COALESCE(NULLIF(api_key_id, ''), 'unknown'),
        MAX(NULLIF(api_key_name, '')),
        LOWER(provider),
        LOWER(model),
        COALESCE(NULLIF(service_tier, ''), 'standard'),
        DATE(timestamp),
        COUNT(*),
        COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(tokens_input), 0),
        COALESCE(SUM(tokens_output), 0),
        COALESCE(SUM(tokens_cache_read), 0),
        COALESCE(SUM(tokens_cache_creation), 0),
        COALESCE(SUM(tokens_reasoning), 0),
        COALESCE(SUM(CASE WHEN success = 1 THEN tokens_input ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN success = 1 THEN tokens_output ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN success = 1 THEN tokens_cache_read ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN success = 1 THEN tokens_cache_creation ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN success = 1 THEN tokens_reasoning ELSE 0 END), 0)
      FROM usage_history
      WHERE timestamp < ?
        AND billing_team_id IS NOT NULL AND billing_team_id != ''
        AND team_rollup_processed_at IS NULL
        AND provider IS NOT NULL AND provider != ''
        AND model IS NOT NULL AND model != ''
      GROUP BY billing_team_id, COALESCE(NULLIF(api_key_id, ''), 'unknown'),
        LOWER(provider), LOWER(model), COALESCE(NULLIF(service_tier, ''), 'standard'), DATE(timestamp)
      ON CONFLICT(team_id, api_key_id, provider, model, service_tier, date) DO UPDATE SET
        api_key_name = COALESCE(excluded.api_key_name, daily_team_usage_summary.api_key_name),
        total_requests = daily_team_usage_summary.total_requests + excluded.total_requests,
        successful_requests = daily_team_usage_summary.successful_requests + excluded.successful_requests,
        total_input_tokens = daily_team_usage_summary.total_input_tokens + excluded.total_input_tokens,
        total_output_tokens = daily_team_usage_summary.total_output_tokens + excluded.total_output_tokens,
        total_cache_read_tokens = daily_team_usage_summary.total_cache_read_tokens + excluded.total_cache_read_tokens,
        total_cache_creation_tokens = daily_team_usage_summary.total_cache_creation_tokens + excluded.total_cache_creation_tokens,
        total_reasoning_tokens = daily_team_usage_summary.total_reasoning_tokens + excluded.total_reasoning_tokens,
        successful_input_tokens = daily_team_usage_summary.successful_input_tokens + excluded.successful_input_tokens,
        successful_output_tokens = daily_team_usage_summary.successful_output_tokens + excluded.successful_output_tokens,
        successful_cache_read_tokens = daily_team_usage_summary.successful_cache_read_tokens + excluded.successful_cache_read_tokens,
        successful_cache_creation_tokens = daily_team_usage_summary.successful_cache_creation_tokens + excluded.successful_cache_creation_tokens,
        successful_reasoning_tokens = daily_team_usage_summary.successful_reasoning_tokens + excluded.successful_reasoning_tokens
    `;
    const aggregateQuery = `
      INSERT INTO daily_usage_summary (provider, model, date, total_requests, total_input_tokens, total_output_tokens, total_cost)
      SELECT
        LOWER(provider) as provider,
        LOWER(model) as model,
        DATE(timestamp) as date,
        COUNT(*) as total_requests,
        COALESCE(SUM(tokens_input), 0) as total_input_tokens,
        COALESCE(SUM(tokens_output), 0) as total_output_tokens,
        0.0 as total_cost
      FROM usage_history
      WHERE timestamp < ?
        AND provider IS NOT NULL AND provider != ''
        AND model IS NOT NULL AND model != ''
      GROUP BY LOWER(provider), LOWER(model), DATE(timestamp)
      ON CONFLICT(provider, model, date) DO UPDATE SET
        total_requests = daily_usage_summary.total_requests + excluded.total_requests,
        total_input_tokens = daily_usage_summary.total_input_tokens + excluded.total_input_tokens,
        total_output_tokens = daily_usage_summary.total_output_tokens + excluded.total_output_tokens
    `;

    const runRollup = db.transaction(() => {
      db.prepare(teamAggregateQuery).run(beforeDate);
      db.prepare(
        `UPDATE usage_history
         SET team_rollup_processed_at = ?
         WHERE timestamp < ?
           AND billing_team_id IS NOT NULL AND billing_team_id != ''
           AND team_rollup_processed_at IS NULL
           AND provider IS NOT NULL AND provider != ''
           AND model IS NOT NULL AND model != ''`
      ).run(rollupStartedAt, beforeDate);
      return db.prepare(aggregateQuery).run(beforeDate);
    });
    const runResult = runRollup();

    result.processed = runResult.changes;
    result.inserted = runResult.changes;

    console.log(
      `[Aggregation] usage_history rollup: ${result.inserted} rows for dates before ${beforeDate}`
    );
  } catch (err: any) {
    console.error("[Aggregation] usage_history rollup error:", err);
    result.errors++;
  }

  return result;
}

/**
 * Get the cutoff date for raw data based on retention settings.
 * Data older than this should be aggregated and cleaned up.
 *
 * @returns ISO date string (YYYY-MM-DD)
 */
export async function getRawDataCutoffDate(): Promise<string> {
  // The raw-data cutoff MUST match the actual rollup/delete boundary used by
  // cleanupUsageHistory (src/lib/db/cleanup.ts), which is driven by
  // retention.usageHistory — NOT aggregation.rawDataRetentionDays.
  // Using rawDataRetentionDays (default 7 per migration 046) creates a gap:
  // analytics floors raw data at day-7 while cleanup doesn't roll up until
  // day-30, so the window [day-30, day-7) is excluded from BOTH UNION legs.
  const rawDataRetentionDays = getUserDatabaseSettings().retention.usageHistory;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - rawDataRetentionDays);

  return cutoffDate.toISOString().split("T")[0];
}

/**
 * Check if aggregation is enabled in settings.
 */
export async function isAggregationEnabled(): Promise<boolean> {
  return getUserDatabaseSettings().aggregation.enabled;
}
