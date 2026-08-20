-- 172_external_identities.sql
-- External identity links for OAuth login (Phase 08, Tasks 04 + 06).
-- Maps a provider-scoped external account (e.g. github:12345) to a local user.
-- Used to log in or auto-provision a local user on callback. A UNIQUE
-- (provider, sub) guarantees one external identity links to exactly one local
-- user (prevents account takeover / link confusion). Additive; no FK coupling
-- back into legacy tables.

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, sub)
);

CREATE INDEX IF NOT EXISTS idx_ext_ident_user ON external_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_ext_ident_provider_sub ON external_identities(provider, sub);
