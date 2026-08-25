import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-team-compat-"));
const originalMigrationsDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
process.env.OMNIROUTE_MIGRATIONS_DIR = migrationsDir;

fs.copyFileSync(
  path.resolve("src/lib/db/migrations/153_radar_local_model_state.sql"),
  path.join(migrationsDir, "153_radar_local_model_state.sql")
);
fs.copyFileSync(
  path.resolve("src/lib/db/migrations/154_call_logs_response_id.sql"),
  path.join(migrationsDir, "154_call_logs_response_id.sql")
);
fs.copyFileSync(
  path.resolve("src/lib/db/migrations/155_agentic_conversations.sql"),
  path.join(migrationsDir, "155_agentic_conversations.sql")
);
fs.copyFileSync(
  path.resolve("src/lib/db/migrations/161_config_audit_log.sql"),
  path.join(migrationsDir, "161_config_audit_log.sql")
);
fs.copyFileSync(
  path.resolve("src/lib/db/migrations/163_team_cost_centers.sql"),
  path.join(migrationsDir, "163_team_cost_centers.sql")
);

const { runMigrations } = await import("../../src/lib/db/migrationRunner.ts");

test.after(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  if (originalMigrationsDir === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
  else process.env.OMNIROUTE_MIGRATIONS_DIR = originalMigrationsDir;
});

for (const legacyVersion of ["153", "154", "155", "161"] as const) {
  test(`an applied ${legacyVersion} Team row is rehomed without hijacking canonical 153/154/155/161`, () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE _omniroute_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE call_logs (id TEXT PRIMARY KEY);
        INSERT INTO _omniroute_migrations (version, name)
        VALUES ('${legacyVersion}', 'team_cost_centers');
      `);

      assert.equal(runMigrations(db), 4);
      assert.deepEqual(
        db.prepare("SELECT version, name FROM _omniroute_migrations ORDER BY version").all(),
        [
          { version: "153", name: "radar_local_model_state" },
          { version: "154", name: "call_logs_response_id" },
          { version: "155", name: "agentic_conversations" },
          { version: "161", name: "config_audit_log" },
          { version: "163", name: "team_cost_centers" },
        ]
      );
      for (const table of [
        "radar_local_model_state",
        "agentic_conversations",
        "config_audit_log",
      ]) {
        assert.ok(
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
          `canonical table ${table} must exist after rehoming Team from ${legacyVersion}`
        );
      }
      assert.ok(
        db
          .prepare("PRAGMA table_info(call_logs)")
          .all()
          .some((column) => (column as { name: string }).name === "response_id"),
        `canonical 154_call_logs_response_id must execute after rehoming Team from ${legacyVersion}`
      );
    } finally {
      db.close();
    }
  });
}
