-- 156_api_keys_user.sql
-- Organizations feature (P1.04 — inference-key principal):
-- link inference API keys to a durable user WITHOUT changing key auth semantics.
-- NULL user_id = a legacy/personal key (current behavior, unchanged).

ALTER TABLE api_keys ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ak_user ON api_keys(user_id);
