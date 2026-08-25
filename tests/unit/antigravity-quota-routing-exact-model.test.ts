/**
 * Regression coverage for Antigravity's mixed per-model and family quota
 * snapshots. Exact client/alias-equivalent buckets take precedence over a
 * family summary or an unrelated Gemini sibling bucket.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-ag-exact-quota-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "ag-exact-quota-test-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const quotaCache = await import("../../src/domain/quotaCache.ts");
const auth = await import("../../src/sse/services/auth.ts");
const fallback = await import("../../open-sse/services/accountFallback.ts");

const resetAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function reset() {
  core.resetDbInstance();
  quotaCache.__clearForTests();
  fallback.clearAllModelLockouts();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function connection(name: string, priority: number) {
  return providersDb.createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    name,
    priority,
    accessToken: `token-${name}`,
    isActive: true,
    testStatus: "active",
  });
}

test.beforeEach(reset);
test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Antigravity selects an exact-positive Flash High bucket despite unrelated zero Gemini bucket", async () => {
  const preferred = await connection("exact-positive", 1);
  const sibling = await connection("fallback", 2);
  quotaCache.setQuotaCache(preferred.id, "antigravity", {
    "gemini-3.5-flash-high": { remainingPercentage: 100, resetAt: resetAt() },
    "gemini-3.5-flash-low": { remainingPercentage: 0, resetAt: resetAt() },
  });
  quotaCache.setQuotaCache(sibling.id, "antigravity", {
    "gemini-3.5-flash-high": { remainingPercentage: 10, resetAt: resetAt() },
  });

  assert.equal(
    quotaCache.isQuotaExhaustedForRequest(preferred.id, "antigravity", "gemini-3.5-flash-high"),
    false
  );
  const selected = await auth.getProviderCredentials(
    "antigravity",
    null,
    null,
    "gemini-3.5-flash-high"
  );
  assert.equal(selected.connectionId, preferred.id);
});

test("Antigravity skips an exact-zero requested bucket even when another Gemini bucket is positive", async () => {
  const exhausted = await connection("exact-zero", 1);
  const healthy = await connection("healthy", 2);
  quotaCache.setQuotaCache(exhausted.id, "antigravity", {
    "gemini-3.5-flash-high": { remainingPercentage: 0, resetAt: resetAt() },
    "gemini-3.5-flash-low": { remainingPercentage: 100, resetAt: resetAt() },
  });
  quotaCache.setQuotaCache(healthy.id, "antigravity", {
    "gemini-3.5-flash-high": { remainingPercentage: 100, resetAt: resetAt() },
  });

  assert.equal(
    quotaCache.isQuotaExhaustedForRequest(exhausted.id, "antigravity", "gemini-3.5-flash-high"),
    true
  );
  const selected = await auth.getProviderCredentials(
    "antigravity",
    null,
    null,
    "gemini-3.5-flash-high"
  );
  assert.equal(selected.connectionId, healthy.id);
});

test("Antigravity uses a family bucket conservatively only when the exact bucket is absent", () => {
  const id = "family-only";
  quotaCache.setQuotaCache(id, "antigravity", {
    gemini_weekly: { remainingPercentage: 0, resetAt: resetAt() },
  });
  assert.equal(
    quotaCache.isQuotaExhaustedForRequest(id, "antigravity", "gemini-3.5-flash-high"),
    true
  );

  quotaCache.setQuotaCache(id, "antigravity", {
    claude_gpt_weekly: { remainingPercentage: 0, resetAt: resetAt() },
  });
  assert.equal(
    quotaCache.isQuotaExhaustedForRequest(id, "antigravity", "gemini-3.5-flash-high"),
    false,
    "an unrelated family must not block a missing exact Gemini bucket"
  );
});

test("known Antigravity 429 keeps its cooldown model-scoped and does not poison exact-positive cache", async () => {
  const conn = await connection("model-429", 1);
  quotaCache.setQuotaCache(conn.id, "antigravity", {
    "gemini-3.5-flash-high": { remainingPercentage: 100, resetAt: resetAt() },
    "claude-sonnet-4-6": { remainingPercentage: 100, resetAt: resetAt() },
  });

  const result = await auth.markAccountUnavailable(
    conn.id,
    429,
    "Individual quota reached. Resets in 1h.",
    "antigravity",
    "gemini-3.5-flash-high"
  );
  assert.equal(result.shouldFallback, true);
  assert.ok(result.cooldownMs > 0);
  assert.equal(
    quotaCache.getQuotaCache(conn.id)?.quotas["gemini-3.5-flash-high"].remainingPercentage,
    100
  );
  assert.equal(
    quotaCache.isQuotaExhaustedForRequest(conn.id, "antigravity", "claude-sonnet-4-6"),
    false
  );
  assert.equal(fallback.isModelLocked("antigravity", conn.id, "gemini-3.5-flash-high"), true);
  assert.equal(fallback.isModelLocked("antigravity", conn.id, "claude-sonnet-4-6"), false);
  const updated = await providersDb.getProviderConnectionById(conn.id);
  assert.equal(updated.rateLimitedUntil, undefined);
});
