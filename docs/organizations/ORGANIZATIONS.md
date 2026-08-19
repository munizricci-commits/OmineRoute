# Organizations (multi-tenant) feature

OmniRoute supports native multi-tenant organizations: a logged-in dashboard user
can belong to one or more organizations, each with its own connections, combos,
and an organization-scoped quota. Organizations are addressed through **qualified
routes** (`<organization>/<route>`), which reuse the existing `auto`/`combo`
machinery — there is **no second routing engine**.

> Invariant: the feature is strictly additive. A plain (non-qualified) model name
> resolves through the legacy personal path exactly as before. See
> `tests/unit/org-compat-*.test.ts` for the regression anchors.

## Roles

| Role             | Capabilities                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `user`           | Use org-scoped routes they are a member of; read org connections/combos they have visibility for.     |
| `moderator`      | Everything `user` can, plus manage org resources (connections, combos, quota) and invite/add members. |
| `owner`          | Everything `moderator` can, plus delete org, archive, and owner transfer.                             |
| `platform_admin` | Cross-organization override for support/operations (enforced server-side).                            |

Authorization is **fail-closed**: a non-member attempting to resolve or read an
organization's resources is rejected (`404` for non-existence / non-membership,
`403` for members lacking the required capability). UI visibility is **never** a
security boundary — every protected operation is re-checked server-side.

## Organization resources

- **Connections** — `src/lib/db/orgConnections.ts`. Org-scoped provider
  connections (`organization_id` column on `provider_connections`). Created only
  by an owner/moderator (`canManageOrganizationResource`). Secrets are stripped
  server-side for viewers without `full` visibility.
- **Combos** — `src/lib/db/orgCombos.ts`. Org-scoped combos referencing only
  org connections. A qualified combo route `team1/combo:dev` resolves only for
  members of `team1`.
- **Quota** — `src/lib/db/orgQuotas.ts` + `src/lib/org/orgQuotaEnforcement.ts`.
  Optional per-org limit (requests / tokens / usd), enforced pre-request from
  the resolved routing scope using the shared Quota Store pool `org:<orgId>`.
  Cross-tenant isolated by pool id.

## Qualified route syntax

```
<organization>/<route>
```

- `<route>` ∈ { combo name, `auto:<strategy>`, provider model id }.
- Examples:
  - `team1/combo:dev` — the `dev` combo owned by `team1`.
  - `team1/auto:coding` — org-scoped auto routing with the `coding` strategy.
  - `team1/anthropic/claude-3-5-sonnet` — an org connection's model.
- A model with **no `/`** is treated as **personal** (Invariant #11) and never
  intercepted by org resolution.

Resolution (`src/lib/org/qualifiedRoute.ts::buildOrgRoutingContext`):

1. Parse the qualified model → `{ organizationSlug, route }`.
2. If no slug → personal scope (`organizationId: null`, `denied: false`).
3. Look up the org by slug. Unknown slug → `denied: true`.
4. Resolve the caller's `OrganizationContext`. Non-member → `denied: true`.
5. Enumerate the org's connections once (no N+1) → `connectionIds`.

## Auto routing scope

`src/lib/org/autoScope.ts::resolveAutoRoutingScope` returns a `RoutingScope`
(`personal` | `organization` | `denied`). For an org-scoped request it builds a
scoped connection-id set (`scopedConnectionIdSet`) and a scoped auto-combo id
(`buildScopedAutoComboId`) so the existing `auto` engine only considers the
org's connections — same code path, isolated pool.

## Migrations

All organization tables/columns are **additive** and idempotent:

| Migration                          | Adds                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `157_organizations.sql`            | `organizations`, `organization_members`, `organization_invitations`  |
| `158_organization_connections.sql` | `organization_id` column on `provider_connections`                   |
| `159_organization_combos.sql`      | `organization_id` column on `combos`                                 |
| `161_organization_quotas.sql`      | `organization_quotas` table (nullable columns; `quota_limit` column) |

Re-running the full migration set on a fresh DB is a no-op for these (idempotent).
Existing personal keys/combos are untouched (verified by `org-compat-migration`).

## API

REST CRUD under `/api/v1/organizations/**` (handlers in
`src/lib/org/orgApiService.ts`, thin route files under
`src/app/api/v1/organizations/`). Dashboard UI under
`src/app/(dashboard)/dashboard/organizations/**`.

Auth: dashboard sessions use a JWT cookie resolved by
`resolveDashboardUserPrincipal`; legacy personal API-key auth and remote
management tokens are **unchanged** by this feature (regression anchors:
`org-compat-api-key`, `org-compat-remote-token`).
