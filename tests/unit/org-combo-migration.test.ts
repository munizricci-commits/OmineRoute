/**
 * P5.01 (combo-scope) — TDD.
 *
 * Verifies the additive organization scoping of the `combos` table:
 *  - a nullable `organization_id` column exists after the 159 migration,
 *  - legacy NULL-org (personal) combos remain queryable (Invariant #1),
 *  - a combo stamped with an organization_id persists and is queryable by org.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-p5-scope-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const combosDb = await import("../../src/lib/db/combos.ts");

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

function columnInfo() {
  const db = core.getDbInstance();
  return db.prepare("PRAGMA table_info(combos)").all() as { name: string; notnull: number }[];
}

test("combos table carries a nullable organization_id column", () => {
  const cols = columnInfo();
  const orgCol = cols.find((c) => c.name === "organization_id");
  assert.ok(orgCol, "organization_id column exists");
  assert.equal(orgCol!.notnull, 0, "organization_id is nullable");
});

test("legacy NULL-org combo is still queryable after the migration", async () => {
  const created = await combosDb.createCombo({
    name: "Personal Combo",
    models: [{ connectionId: "conn-personal", provider: "openai", model: "gpt-4o" }],
  });
  assert.ok(created.id);

  // The column defaults to NULL for legacy rows.
  const db = core.getDbInstance();
  const row = db.prepare("SELECT organization_id FROM combos WHERE id = ?").get(created.id) as {
    organization_id: string | null;
  };
  assert.equal(row.organization_id ?? null, null, "legacy combo has NULL organization_id");

  // Still resolvable through the existing read path.
  const byName = await combosDb.getComboByName("Personal Combo");
  assert.ok(byName);
  assert.equal(byName!.id, created.id);
  const list = await combosDb.getCombos();
  assert.ok(list.some((c) => c.id === created.id));
});

test("a combo stamped with an organization_id persists and is queryable by org", async () => {
  const created = await combosDb.createCombo({
    name: "Org Combo",
    models: [{ connectionId: "conn-org", provider: "openai", model: "gpt-4o" }],
  });
  assert.ok(created.id);

  const db = core.getDbInstance();
  db.prepare("UPDATE combos SET organization_id = ? WHERE id = ?").run("org-123", created.id);

  const row = db.prepare("SELECT organization_id FROM combos WHERE id = ?").get(created.id) as {
    organization_id: string | null;
  };
  assert.equal(row.organization_id, "org-123", "organization_id persisted");

  // Org-scoped read returns exactly the org combo.
  const orgRows = db.prepare("SELECT id FROM combos WHERE organization_id = ?").all("org-123") as {
    id: string;
  }[];
  assert.equal(orgRows.length, 1);
  assert.equal(orgRows[0].id, created.id);
});
