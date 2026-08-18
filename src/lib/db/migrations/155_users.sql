-- 155_users.sql
-- Organizations feature (P1 — Identity): durable user entity.
-- All columns are nullable-safe and additive. Existing personal configuration
-- (api_keys bound to machine_id, no users row) is unaffected — a NULL
-- api_keys.user_id means a legacy/personal key, exactly as before.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  -- Minimal platform role: 'user' (ordinary) | 'platform_admin' (operator).
  -- No enterprise RBAC. See _tasks/P0-architecture/PHASE0_VERDICT.md.
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
