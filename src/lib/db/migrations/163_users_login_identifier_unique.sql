-- 163_users_login_identifier_unique.sql
-- 01-admin-identity / Task 03: uniqueness + validation support for login_identifier.
--
-- Adds a PARTIAL UNIQUE index so non-null login_identifiers are unique while
-- NULLs (users without one yet) remain allowed. SQLite unique indexes permit
-- multiple NULL rows, but we scope the index to NOT NULL anyway for clarity and
-- to keep the constraint aligned with the app-layer validation.
--
-- Idempotency: runner version tracking records version 163 once; the CREATE
-- UNIQUE INDEX itself is IF NOT EXISTS-safe. If a pre-existing DB already has
-- the index (e.g. a re-run under a renumbered slot), the retroactive guard in
-- migrationRunner.ts skips re-execution.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_identifier_unique
  ON users(login_identifier) WHERE login_identifier IS NOT NULL;
