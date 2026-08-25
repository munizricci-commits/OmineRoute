// ENVIRONMENT NOTE (sandbox better-sqlite3 / glibc limitation, not a code defect):
// This test constructs a real better-sqlite3-backed SQLite database.
// better-sqlite3 is a native addon; production and CI load it normally, but some
// sandboxes/dev boxes ship a system glibc older than the prebuilt binary requires
// ("GLIBC_2.29 not found"), so the native module fails to dlopen and any test that
// reaches better-sqlite3 directly (or asserts stdout that the load-failure warning
// would pollute) fails HERE while passing in CI. This is a known environment
// limitation, not a defect in the code under test: the OmniRoute runtime itself
// cascades to node:sqlite/sql.js when better-sqlite3 is unavailable. See
// tests/unit/_helpers/betterSqlite3Availability.ts for a guard helper.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import {
  betterSqlite3Available,
  BETTER_SQLITE3_SKIP_REASON,
} from "./_helpers/betterSqlite3Availability";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OMNIROUTE_BIN = path.join(ROOT, "bin", "omniroute.mjs");
const ORIGINAL_PASSWORD = "MyStr0ng!P@ss";
const DANGEROUS_INITIAL_PASSWORD = "CHANGEME";

function baseEnv(dataDir: string, isolatedHome: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  return {
    ...env,
    DATA_DIR: dataDir,
    HOME: isolatedHome,
    STORAGE_ENCRYPTION_KEY: "0".repeat(64),
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
    OMNIROUTE_NO_UPDATE_NOTIFIER: "1",
    OMNIROUTE_CLI_SKIP_REPO_ENV: "1",
    INITIAL_PASSWORD: DANGEROUS_INITIAL_PASSWORD,
  };
}

function seedDb(dataDir: string, passwordHash: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "storage.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.prepare(
    `CREATE TABLE IF NOT EXISTS key_value (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (namespace, key)
    )`
  ).run();
  db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', ?, ?)"
  ).run("password", JSON.stringify(passwordHash));
  db.close();
  return dbPath;
}

function readStoredPassword(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT value FROM key_value WHERE namespace = 'settings' AND key = 'password'")
      .get() as { value?: string } | undefined;
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  } finally {
    db.close();
  }
}

function mkHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-setup-home-"));
}

function mkDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-setup-data-"));
}

async function runSetup(
  dataDir: string,
  home: string,
  extraArgs: string[] = []
): Promise<{ status: number | null; output: string }> {
  const res = spawnSync(
    "node",
    [
      OMNIROUTE_BIN,
      "setup",
      "--non-interactive",
      "--add-provider",
      "--api-key",
      "test123",
      ...extraArgs,
    ],
    {
      env: baseEnv(dataDir, home),
      timeout: 60_000,
      encoding: "utf-8",
    }
  );
  const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  return { status: res.status, output };
}

test(
  "setup preserves existing admin password when --password is not provided (#11494)",
  { skip: betterSqlite3Available() ? false : BETTER_SQLITE3_SKIP_REASON },
  async () => {
    const dataDir = mkDataDir();
    const home = mkHome();
    try {
      const existingHash = await bcrypt.hash(ORIGINAL_PASSWORD, 12);
      const dbPath = seedDb(dataDir, existingHash);

      const { status, output } = await runSetup(dataDir, home);
      assert.equal(status, 0, `expected exit 0, got ${status}. Output:\n${output}`);
      assert.match(output, /Using existing admin password/i, `must notify password preservation:\n${output}`);

      const stored = readStoredPassword(dbPath);
      assert.ok(stored, "a password must remain persisted to the DB");
      assert.ok(
        await bcrypt.compare(ORIGINAL_PASSWORD, stored as string),
        "the stored password must still verify against the original strong password"
      );
      assert.ok(
        !(await bcrypt.compare(DANGEROUS_INITIAL_PASSWORD, stored as string)),
        "the stored password must NOT verify against the dangerous INITIAL_PASSWORD fallback"
      );
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
);

test(
  "setup overwrites existing admin password when --password is explicitly provided (#11494)",
  { skip: betterSqlite3Available() ? false : BETTER_SQLITE3_SKIP_REASON },
  async () => {
    const dataDir = mkDataDir();
    const home = mkHome();
    try {
      const existingHash = await bcrypt.hash(ORIGINAL_PASSWORD, 12);
      const dbPath = seedDb(dataDir, existingHash);
      const explicitPassword = "N3wExplic!tPass";

      const { status, output } = await runSetup(dataDir, home, ["--password", explicitPassword]);
      assert.equal(status, 0, `expected exit 0, got ${status}. Output:\n${output}`);
      assert.doesNotMatch(
        output,
        /Using existing admin password/i,
        `must not notify preservation when password is explicitly overridden:\n${output}`
      );

      const stored = readStoredPassword(dbPath);
      assert.ok(stored, "a password must remain persisted to the DB");
      assert.ok(
        await bcrypt.compare(explicitPassword, stored as string),
        "the stored password must verify against the explicitly provided password"
      );
      assert.ok(
        !(await bcrypt.compare(ORIGINAL_PASSWORD, stored as string)),
        "the stored password must NOT verify against the previous password"
      );
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
);
