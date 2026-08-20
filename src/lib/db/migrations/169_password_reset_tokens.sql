-- 169_password_reset_tokens.sql
-- 06-password-recovery / Task 01: one-time, expiring password reset tokens.
--
-- Stores only a hash of the reset token (the raw token is shown once to the
-- user in the email link and never persisted). Tokens are single-use (used=1)
-- and time-limited (expires_at). Lookups are by token_hash for constant-time
-- equality and to avoid storing the raw secret.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe on re-run.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
