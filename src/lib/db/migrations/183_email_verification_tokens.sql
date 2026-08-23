-- 183_email_verification_tokens.sql
-- P4 — Email Verification for Registration: one-time, expiring verification tokens.
--
-- Mirrors password_reset_tokens (169): only a SHA-256 hash of the raw token is
-- stored (raw token shown once in the email link, never persisted). Tokens are
-- single-use (used=1) and time-limited (expires_at). Lookups are by token_hash.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe on re-run.

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  email TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
