-- 164_instance_auth_settings.sql
-- 02-multi-user-mode / Task 01: persisted instance authentication settings.
--
-- Singleton row (id = 'singleton') holding instance-wide auth configuration.
-- multi_user_enabled defaults to 0 (OFF) so existing single-admin installations
-- behave identically after upgrade. registration_policy defaults to 'disabled'.
--
-- Idempotent: runner version tracking records version 164 once; CREATE TABLE
-- IF NOT EXISTS is safe on re-run.

CREATE TABLE IF NOT EXISTS instance_auth_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  multi_user_enabled INTEGER NOT NULL DEFAULT 0,
  registration_policy TEXT NOT NULL DEFAULT 'disabled',
  updated_at TEXT NOT NULL
);
