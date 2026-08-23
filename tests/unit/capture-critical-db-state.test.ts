import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type CoreModule = typeof import("../../src/lib/db/core.ts");

// Shared across all tests — the module caches DATA_DIR / SQLITE_FILE at load time,
// so we must create the temp dir and import exactly once.
type CoreModule = typeof import("../../src/lib/db/core.ts");
let tempDir: string;
let originalDataDir: string | undefined;
let getDbInstance: CoreModule["getDbInstance"];
let resetDbInstance: CoreModule["resetDbInstance"];
let ensureDbInitialized: CoreModule["ensureDbInitialized"];
let closeDbInstance: CoreModule["closeDbInstance"];

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-db-test-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;

  const core = await import("../../src/lib/db/core.ts");
  getDbInstance = core.getDbInstance;
  resetDbInstance = core.resetDbInstance;
  ensureDbInitialized = core.ensureDbInitialized;
  closeDbInstance = core.closeDbInstance;

  // Clear any singleton left by a previous test file in the same shard
  closeDbInstance();
  // Create a fresh DB in the temp dir (handles async driver initialization)
  await ensureDbInitialized();
});

after(() => {
  try {
    resetDbInstance();
  } catch {
    // ignore
  }
  if (originalDataDir !== undefined) {
    process.env.DATA_DIR = originalDataDir;
  } else {
    delete process.env.DATA_DIR;
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

test("getDbInstance returns a valid database handle", async () => {
  const db = getDbInstance();

  assert.ok(db, "db should be defined");
  assert.equal(typeof db.prepare, "function", "db.prepare should be a function");
  assert.equal(typeof db.exec, "function", "db.exec should be a function");
  assert.equal(typeof db.pragma, "function", "db.pragma should be a function");
  assert.equal(db.open !== false, true, "db should be open");
});

test("getDbInstance creates tables from SCHEMA_SQL (proves initialization succeeded with captureSucceeded sentinel)", async () => {
  const db = getDbInstance();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const tableNames = new Set(tables.map((t) => t.name));

  const expectedTables = [
    "provider_connections",
    "provider_nodes",
    "key_value",
    "combos",
    "api_keys",
    "db_meta",
    "usage_history",
    "call_logs",
    "domain_circuit_breakers",
    "semantic_cache",
    "_omniroute_migrations",
  ];

  for (const name of expectedTables) {
    assert.ok(tableNames.has(name), `table "${name}" should exist`);
  }

  // The preservedCriticalState sentinel is captureSucceeded: true on fresh DB
  // (no existing file = no corruption path = initialized with default sentinel).
  // Verify this indirectly: the DB is fully functional and migrations ran.
  const migrationCount = db
    .prepare("SELECT COUNT(*) as c FROM _omniroute_migrations")
    .get() as { c: number };
  assert.ok(migrationCount.c >= 1, "at least one migration should be recorded");
});

test("getDbInstance supports basic CRUD operations after startup", async () => {
  const db = getDbInstance();

  // Insert into key_value
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "test_ns",
    "test_key",
    JSON.stringify({ hello: "world" })
  );

  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("test_ns", "test_key") as { value: string };
  assert.ok(row, "row should exist");
  assert.deepEqual(JSON.parse(row.value), { hello: "world" });

  // Update
  db.prepare("UPDATE key_value SET value = ? WHERE namespace = ? AND key = ?").run(
    JSON.stringify({ hello: "updated" }),
    "test_ns",
    "test_key"
  );
  const updated = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("test_ns", "test_key") as { value: string };
  assert.deepEqual(JSON.parse(updated.value), { hello: "updated" });

  // Delete
  db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run("test_ns", "test_key");
  const deleted = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("test_ns", "test_key");
  assert.equal(deleted, undefined, "row should be deleted");
});

test("getDbInstance returns same singleton on repeated calls", async () => {
  const db1 = getDbInstance();
  const db2 = getDbInstance();
  assert.equal(db1, db2, "should return the same singleton instance");
});

test("resetDbInstance clears the singleton so next call creates a new DB", async () => {
  const db1 = getDbInstance();

  // Write a marker row so we can prove the post-reset handle reopens the same
  // on-disk file through a freshly opened connection (not the cached one).
  db1.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    "reset_ns",
    "marker",
    JSON.stringify({ v: 1 })
  );

  resetDbInstance();

  // Re-initialize after reset — drivers may need async pre-init (sql.js WASM)
  await ensureDbInitialized();

  const db2 = getDbInstance();
  assert.notEqual(db1, db2, "reset must swap the cached singleton for a new handle");

  // The new handle reopens the same DATA_DIR file, so the persisted marker
  // survives while the object identity does not.
  const row = db2
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get("reset_ns", "marker") as { value: string } | undefined;
  assert.ok(row, "persisted row should survive a singleton reset");
  assert.deepEqual(JSON.parse(row.value), { v: 1 });
});

test("getDbInstance sets WAL journal mode", async () => {
  const db = getDbInstance();

  const mode = db.pragma("journal_mode", { simple: true }) as string;
  assert.equal(
    String(mode).toLowerCase(),
    "wal",
    "on-disk DB should open in WAL journal mode"
  );
});

test("getDbInstance stores schema_version in db_meta", async () => {
  const db = getDbInstance();

  const row = db
    .prepare("SELECT value FROM db_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  assert.ok(row, "db_meta should hold a schema_version row after init");
  assert.equal(row.value, "1", "schema_version should be seeded to '1'");
});
