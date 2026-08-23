-- 161_organization_quotas.sql
-- P9.02 — Additive organization-wide quota configuration.
--
-- Adds a per-organization quota row. This is ADDITIVE: it introduces a new
-- table only and never touches the legacy personal/registered-key quota tables
-- (provider_key_limits / account_key_limits / registered_keys) nor the
-- quota_sharing engine tables. A database with zero organization_quotas rows
-- behaves exactly as before (Invariant #1 — personal quota unchanged).
--
-- Columns:
--   organization_id  PK — FK to organizations.id (enforced by app layer)
--   limit            INTEGER NULLABLE — requests/tokens/usd cap; NULL = unlimited
--   window           TEXT NULLABLE    — quota window ('hourly' | 'daily' | ...)
--   scope            TEXT NULLABLE    — quota unit ('requests' | 'tokens' | 'usd')
--   updated_at       TEXT NOT NULL    — last write timestamp (audit)

CREATE TABLE IF NOT EXISTS organization_quotas (
  organization_id TEXT PRIMARY KEY,
  quota_limit INTEGER,
  window TEXT,
  scope TEXT,
  updated_at TEXT NOT NULL
);
