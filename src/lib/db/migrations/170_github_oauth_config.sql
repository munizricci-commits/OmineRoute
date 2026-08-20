-- 170_github_oauth_config.sql
-- GitHub OAuth login configuration (Phase 08 — GitHub OAuth).
-- Singleton row (provider='github'). client_secret is encrypted at rest via the
-- shared storage encryption helper; readers never return the plaintext secret.
-- Additive: no FK coupling back into legacy tables, zero data loss on upgrade.

CREATE TABLE IF NOT EXISTS github_oauth_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL DEFAULT '',
  client_secret_enc TEXT NOT NULL DEFAULT '',
  redirect_uri TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
