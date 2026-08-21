-- 167_users_email_unique.sql
-- 04-registration / Task 05: uniqueness support for email on the users table.
--
-- Adds a PARTIAL UNIQUE index so non-null emails are unique (case-insensitive
-- storage is enforced by the app layer lower-casing on write) while NULL emails
-- remain allowed. Mirrors the existing login_identifier unique index (163).
--
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS is safe on re-run; the
-- migration runner records version 167 once.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL;
