-- 171_github_oauth_states.sql
-- Github OAuth login flow: CSRF state store (Phase 08, Task 03).
-- The `state` parameter is an unguessable, single-use, expiring token bound to a
-- login attempt. Stored server-side and verified on callback to prevent CSRF /
-- authorization-code injection. Additive; no FK coupling.

CREATE TABLE IF NOT EXISTS github_oauth_states (
  state TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gh_oauth_states_exp ON github_oauth_states(expires_at);
