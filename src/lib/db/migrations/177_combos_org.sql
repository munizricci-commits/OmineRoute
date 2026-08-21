-- P5.01: Additive organization scoping for combos.
--
-- Legacy personal combos keep organization_id = NULL and behave exactly as
-- before (Invariant #1: legacy personal keys/combos keep working). New
-- org-owned combos set organization_id to the owning organization's id.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so idempotency is guaranteed by the
-- migration runner's version tracking (this file records version 159 once) and
-- by the `isSchemaAlreadyApplied` retroactive guard in migrationRunner.ts,
-- which skips re-execution on any DB that already carries the column. The
-- CREATE INDEX is itself `IF NOT EXISTS`-safe.

ALTER TABLE combos ADD COLUMN organization_id TEXT;
CREATE INDEX IF NOT EXISTS idx_combos_org ON combos(organization_id);
