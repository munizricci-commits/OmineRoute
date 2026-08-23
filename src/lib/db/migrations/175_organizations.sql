-- 157_organizations.sql
-- Organizations feature (P2 — Organizations):
-- organizations, organization_members, organization_invitations.
--
-- Additive, nullable-friendly schema. Existing personal config (no org rows)
-- is completely untouched — these are new tables with no foreign-key coupling
-- back into legacy personal tables, so zero data loss on upgrade.
--
-- Slug uniqueness is enforced by a UNIQUE index. Creating an org also inserts
-- an `owner` membership row (see src/lib/db/organizations.ts, inside a
-- transaction). The organization_invitations table is created here even though
-- it is first consumed by P2.04, so the schema is coherent from the start.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orgs_slug ON organizations(slug);

CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- owner | moderator | user
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- owner | moderator | user
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
  expires_at TEXT NOT NULL,
  invited_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON organization_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invitations(organization_id);
