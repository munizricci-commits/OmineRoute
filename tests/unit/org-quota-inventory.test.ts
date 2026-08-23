/**
 * P9.01 — quota-inventory: regression anchor for the EXISTING personal quota
 * path.
 *
 * This task is ANALYSIS + a backward-compatibility anchor. It adds NO production
 * code. The test asserts that the current personal quota machinery still behaves
 * as before, so that P9.02/03/04 (which add an additive organization dimension)
 * can never silently regress the legacy personal path (Invariant #1).
 *
 * Inventory of the current quota primitives (see agent REPORTS.md `## P9`):
 *   - `src/lib/db/registeredKeys.ts::checkQuota(provider, accountId)` — per
 *     provider/account ISSUE quota for registered keys. Keyed by provider /
 *     accountId rows in `provider_key_limits` / `account_key_limits`. Backs the
 *     `GET /api/v1/quotas/check` endpoint. No org dimension.
 *   - `src/lib/quota/enforce.ts::enforceQuotaShare(input)` — PRE-request
 *     enforcement for the request hot path. Keyed by apiKeyId + the quota POOL
 *     the key belongs to (pool shares a connection). A personal key with NO pool
 *     assignment is unrestricted (fail-open, B16). Backs chat routing.
 *   - `src/lib/quota/sqliteQuotaStore.ts` — sliding-window counter keyed by
 *     (apiKeyId, dimensionKey) where dimensionKey embeds poolId. `poolConsumedTotal`
 *     aggregates across all apiKeys sharing a poolId. P9 reuses THIS store for the
 *     org dimension (poolId = `org:<orgId>`).
 *   - `src/app/api/usage/quota/route.ts` — per-connection usage dashboard (learned
 *     limits / rate-limit status); unrelated to the issue/request quota above.
 *
 * The anchor exercises the two personal paths that P9 must not break:
 *   1. `checkQuota` returns allowed=true when no provider/account limits are set.
 *   2. `enforceQuotaShare` returns allow for a personal key that belongs to no pool.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-quota-inv-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const registeredKeysDb = await import("../../src/lib/db/registeredKeys.ts");
const { enforceQuotaShare } = await import("../../src/lib/quota/enforce.ts");

async function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

test("personal key issue-quota check passes when no provider/account limits are configured", () => {
  // No rows in provider_key_limits / account_key_limits exist for these ids,
  // so the personal path must allow key issuance (backward-compat anchor).
  const noProvider = registeredKeysDb.checkQuota();
  assert.equal(noProvider.allowed, true, "empty checkQuota must allow");

  const byProvider = registeredKeysDb.checkQuota("anthropic", "");
  assert.equal(byProvider.allowed, true, "unknown provider must allow");

  const byAccount = registeredKeysDb.checkQuota("", "acct-xyz-123");
  assert.equal(byAccount.allowed, true, "unknown account must allow");
});

test("personal request path is unrestricted when the key has no quota pool (allow)", async () => {
  // A personal key with no quota-pool assignment is unrestricted: enforceQuotaShare
  // short-circuits to allow before touching the store (fail-open, B16). This is the
  // legacy behavior P9 must preserve for personal traffic.
  const decision = await enforceQuotaShare({
    apiKeyId: "personal-key-without-pool",
    connectionId: "conn-personal",
    provider: "anthropic",
  });
  assert.equal(decision.kind, "allow");
});
