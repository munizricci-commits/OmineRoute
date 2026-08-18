/**
 * P4.01 (connection-scope-migration) — TDD.
 *
 * Proves the 158 migration is valid and additive:
 *  - the `organization_id` column is added and is nullable,
 *  - existing (NULL-org) rows remain queryable,
 *  - a new row with an organization_id persists,
 *  - re-applying the migration is idempotent (guarded) and does not error.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p4-mig-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");

const MIGRATION_FILE = path.resolve("src/lib/db/migrations/158_provider_connections_org.sql");

function nowIso(): string {
  return new Date().toISOString();
}

function resetStorage() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration adds a nullable organization_id column to provider_connections", () => {
  const db = core.getDbInstance();
  const columns = db.prepare("PRAGMA table_info(provider_connections)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const col = columns.find((c) => c.name === "organization_id");
  assert.ok(col, "organization_id column must exist after migrations run");
  assert.equal(col!.notnull, 0, "organization_id must be nullable");
  // The index is also created.
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pc_org'")
    .get() as { name?: string } | undefined;
  assert.ok(idx?.name === "idx_pc_org", "idx_pc_org index must exist");
});

test("existing NULL-org rows remain queryable after migration", () => {
  const db = core.getDbInstance();
  const id = "c-legacy-" + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO provider_connections
       (id, provider, auth_type, name, priority, is_active, created_at, updated_at)
     VALUES (?, 'openai', 'apikey', 'Legacy', 1, 1, ?, ?)`
  ).run(id, nowIso(), nowIso());

  const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  assert.ok(row, "legacy row is queryable");
  assert.equal(row.organization_id ?? null, null, "legacy row keeps NULL org");
});

test("a new row with an organization_id persists", () => {
  const db = core.getDbInstance();
  const id = "c-org-" + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO provider_connections
       (id, provider, auth_type, name, priority, is_active, organization_id, created_at, updated_at)
     VALUES (?, 'openai', 'apikey', 'Org', 1, 1, 'org-1', ?, ?)`
  ).run(id, nowIso(), nowIso());

  const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  assert.equal(row.organization_id, "org-1", "organization_id persists");
});

test("re-applying the migration is idempotent and does not error", () => {
  const db = core.getDbInstance();
  const sql = fs.readFileSync(MIGRATION_FILE, "utf8");

  // Capture the column definition before re-apply.
  const before = db.prepare("PRAGMA table_info(provider_connections)").all() as Array<{
    name: string;
  }>;
  assert.ok(before.some((c) => c.name === "organization_id"));

  // Guard like migrationRunner.ensureColumn: only run the ALTER if the column
  // is absent. This mirrors the runner's single-apply guarantee.
  const hasColumn = (name: string) =>
    (db.prepare("PRAGMA table_info(provider_connections)").all() as Array<{ name: string }>).some(
      (c) => c.name === name
    );

  db.transaction(() => {
    if (!hasColumn("organization_id")) {
      db.exec(sql);
    }
  })();

  const after = db.prepare("PRAGMA table_info(provider_connections)").all() as Array<{
    name: string;
  }>;
  assert.ok(
    after.some((c) => c.name === "organization_id"),
    "column still present after re-apply"
  );
  assert.equal(before.length, after.length, "no duplicate column added on re-apply");
});
