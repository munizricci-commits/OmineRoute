-- 162_users_login_identifier.sql
-- 01-admin-identity / Task 01: durable login identifier on the user identity.
--
-- Adds a nullable `login_identifier` to `users` so a platform user can be
-- addressed by a stable login name/email (in addition to the existing password
-- and the org membership anchors). This is ADDITIVE and changes NO authentication
-- behavior: the legacy management-password login and the existing personal/org
-- flows are untouched. Uniqueness and normalization of the identifier are enforced
-- later (Task 03); here the column is merely stored and readable.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so idempotency is guaranteed by the
-- migration runner's version tracking (this file records version 162 once) and by
-- the `isSchemaAlreadyApplied` retroactive guard in migrationRunner.ts, which
-- skips re-execution on any DB that already carries the column. The CREATE INDEX
-- is itself `IF NOT EXISTS`-safe.

ALTER TABLE users ADD COLUMN login_identifier TEXT;
CREATE INDEX IF NOT EXISTS idx_users_login_identifier ON users(login_identifier);
