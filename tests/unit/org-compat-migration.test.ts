/**
 * P10.04 — migration-safety: REGRESSION ANCHOR proving the Organizations
 * migrations (157 / 158 / 159 / 161) are ADDITIVE and IDEMPOTENT (Invariant #1).
 *
 * Adds NO production code. What is pinned here:
 *   1. On a FRESH database the full migration set runs and creates the new org
 *      tables: `organizations`, `organization_members`, `organization_invitations`,
 *      `organization_quotas`.
 *   2. Org SCOPING of connections and combos is implemented as an ADDITIVE
 *      NULLABLE COLUMN on the existing legacy tables (`provider_connections.
 *      organization_id` from 158, `combos.organization_id` from 159) — there is no
 *      separate `organization_connections` / `organization_combos` table, and the
 *      legacy tables keep every pre-existing column. This test pins that shape.
 *   3. NO legacy table was dropped: a representative set of legacy tables still
 *      exists after the org migrations.
 *   4. Re-running the migration set (fresh db instance over the SAME file) is a
 *      no-op: the full schema snapshot is byte-identical before and after, and no
 *      duplicate rows / errors occur.
 *   5. A fresh DB with ZERO org rows can still serve a legacy personal
 *      operation (create + validate a personal API key), i.e. org data is not a
 *      prerequisite for legacy behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-org-compat-mig-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";
process.env.JWT_SECRET = "test-jwt-secret";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");

const DB_FILES = ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"];

/** New tables introduced by the organizations feature. */
const ORG_TABLES = [
  "organizations",
  "organization_members",
  "organization_invitations",
  "organization_quotas",
];

/** Representative legacy tables that must survive the org migrations untouched. */
const LEGACY_TABLES = ["api_keys", "provider_connections", "combos", "users"];

function resetStorage() {
  core.resetDbInstance();
  for (const f of DB_FILES) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
}

function tableNames(db: { prepare: (s: string) => { all: () => unknown[] } }): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name).sort();
}

/** Full schema snapshot (tables + indexes + triggers), order-stable. */
function schemaSnapshot(db: { prepare: (s: string) => { all: () => unknown[] } }): string {
  const rows = db
    .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
    .all() as Array<{ type: string; name: string; sql: string | null }>;
  return rows.map((r) => `${r.type}\t${r.name}\t${r.sql ?? ""}`).join("\n");
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  for (const f of DB_FILES) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {}
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

test("fresh DB gains every organization table after migrations", () => {
  const db = core.getDbInstance();
  const names = tableNames(db as never);
  for (const t of ORG_TABLES) {
    assert.ok(names.includes(t), `${t} must exist after migrations`);
  }
});

test("org scoping for connections and combos is an additive nullable column", () => {
  const db = core.getDbInstance();

  for (const table of ["provider_connections", "combos"]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const org = cols.find((c) => c.name === "organization_id");
    assert.ok(org, `${table}.organization_id must exist`);
    assert.equal(org!.notnull, 0, `${table}.organization_id must be NULLABLE (additive)`);
  }

  // There is deliberately no separate join table for these two scopes.
  const names = tableNames(db as never);
  assert.equal(names.includes("organization_connections"), false);
  assert.equal(names.includes("organization_combos"), false);
});

test("no legacy table was dropped or renamed by the org migrations", () => {
  const db = core.getDbInstance();
  const names = tableNames(db as never);
  for (const t of LEGACY_TABLES) {
    assert.ok(names.includes(t), `legacy table ${t} must still exist`);
  }

  // Legacy required columns still present (no destructive rewrite).
  const apiKeyCols = (
    db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>
  ).map((c) => c.name);
  for (const c of ["id", "name", "key", "created_at"]) {
    assert.ok(apiKeyCols.includes(c), `api_keys.${c} must survive migrations`);
  }
});

test("re-running the migration set is a no-op (idempotent schema)", () => {
  const first = core.getDbInstance();
  const before = schemaSnapshot(first as never);
  const tablesBefore = tableNames(first as never);

  // Re-open the SAME database file: the migration runner executes again over an
  // already-migrated schema.
  core.resetDbInstance();
  const second = core.getDbInstance();
  const after = schemaSnapshot(second as never);
  const tablesAfter = tableNames(second as never);

  assert.deepEqual(tablesAfter, tablesBefore, "table set must be identical after re-run");
  assert.equal(after, before, "full schema snapshot must be identical after re-run");

  // And a third run still changes nothing.
  core.resetDbInstance();
  const third = core.getDbInstance();
  assert.equal(schemaSnapshot(third as never), before, "migrations remain idempotent");
});

test("a fresh DB with zero org rows still serves a legacy personal operation", async () => {
  const db = core.getDbInstance();
  const orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as { n: number };
  assert.equal(orgCount.n, 0, "fresh DB has no organizations");

  const created = await apiKeysDb.createApiKey("fresh-db-personal", "machine-fresh-1", []);
  assert.ok(created?.key, "personal API key creation works with no org data");

  const meta = await apiKeysDb.getApiKeyMetadata(created.key);
  assert.ok(meta, "personal key resolves with no org data");
  assert.equal(meta!.id, created.id);

  // Org tables remain empty — the legacy path wrote nothing into them.
  const stillZero = db.prepare("SELECT COUNT(*) AS n FROM organization_members").get() as {
    n: number;
  };
  assert.equal(stillZero.n, 0, "legacy path must not populate org tables");
});
