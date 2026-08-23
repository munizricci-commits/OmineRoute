-- 182_users_email_verified.sql
-- P4 — Email Verification for Registration: track email verification state.
--
-- Adds a NOT NULL DEFAULT 0 column so existing rows are treated as verified
-- (registration before this feature behaved as "verified immediately"). New rows
-- created with SMTP configured start as unverified (0) and must confirm.
--
-- Idempotent: guard the ALTER so re-runs on an already-migrated DB are no-ops.

ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
