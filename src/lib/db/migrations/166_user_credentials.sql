-- 166_user_credentials.sql
-- 04-registration / Task 02: per-user password credentials for registered accounts.
-- Separate from the legacy management-password bootstrap; registered users authenticate
-- with their own login + password. One credential row per user.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; re-run is safe.

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
