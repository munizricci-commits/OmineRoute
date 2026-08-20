-- 168_smtp_config.sql
-- 05-email-smtp / Task 02: persisted SMTP configuration (singleton row).
--
-- Stores the SMTP server settings required to deliver transactional email
-- (invitations, verification, password reset). The password column holds an
-- AES-256-GCM encrypted blob produced by src/lib/db/encryption.ts; it is never
-- returned in plaintext by the read path (getSmtpConfig masks it).
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe on re-run; the migration
-- runner records version 168 once.

CREATE TABLE IF NOT EXISTS smtp_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  enabled INTEGER NOT NULL DEFAULT 0,
  host TEXT,
  port INTEGER,
  secure INTEGER NOT NULL DEFAULT 0,
  user TEXT,
  password TEXT,
  from_address TEXT,
  updated_at TEXT NOT NULL
);
