# Organizations security model

This document defines the trust boundaries for the multi-tenant Organizations
feature and the server-side enforcement that backs them.

## Trust boundaries

| Boundary                     | What it proves                                                              | Enforced by                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard session**        | The caller is an authenticated dashboard user (JWT cookie).                 | `resolveDashboardUserPrincipal` (`src/lib/org/principal.ts`) — verifies the JWT against `JWT_SECRET` and loads the user. No cookie / bad signature → `401`.                     |
| **Inference (personal) key** | The caller may use a personal API key for `/v1/chat/completions`.           | Legacy `Authorization: Bearer sk-…` / `x-api-key` resolution (`src/sse/services/auth.ts`). **Unchanged** by the org feature.                                                    |
| **Management token**         | A remote/management key with `manage`/`admin` scope may perform operations. | Legacy management-token verification (`MANAGEMENT_API_KEY_SCOPES = {"manage","admin"}`). **Unchanged** by the org feature.                                                      |
| **Organization scope**       | The caller is a member of the target org with the required capability.      | `resolveOrgAccess(principal, orgId, capability)` (`src/lib/org/apiAuth.ts`) → `OrganizationContext`. Non-member / missing capability → `OrgAccessDeniedError` (`404` or `403`). |

## Authorization model (fail-closed)

All protected operations go through `canManageOrganizationResource`,
`canReadOrganization`, `canUseOrganizationResource` (and the capability variants
in `resolveOrgAccess`). The default is **deny**:

- A non-member resolving `teamB/combo:dev` gets `denied: true` — never Org B's
  data, never a hint that Org B exists (uniform `404`).
- A member lacking `manageResource` who tries to set Org quota gets `403`.
- `platform_admin` is the only cross-org override, and is itself a server-side
  check (never client-asserted).

**UI visibility is not a security boundary.** The dashboard hides controls a
viewer may not use, but every API call re-runs the same server-side checks.
Defence relies on the API, not the UI.

## Secret boundary

Provider credentials (`apiKey`, `accessToken`, `refreshToken`, `idToken`) are
stored encrypted at rest. At read time, `redactConnectionCredentials(conn,
visibility)` strips them unless the viewer has `full` visibility (owner/
moderator of the owning org). The org connection list API
(`/[id]/connections`) never returns raw secrets to a non-`full` viewer
(verified by `org-security-secret-redaction`).

Error responses route through `buildErrorBody()` / `sanitizeErrorMessage()` —
raw `err.message` / stack traces are never returned to the client.

## Cross-tenant isolation

- **Routing**: `buildOrgRoutingContext` enumerates only the target org's
  connections (pool `org:<orgId>`); a member of Org A cannot resolve Org B's
  routes (`org-security-cross-org`).
- **Quota**: enforcement uses the shared Quota Store with pool id
  `org:<orgId>`; Org A consumption never appears under Org B
  (`org-security-concurrency`).
- **Resources**: connections/combos/members/invitations are scoped by
  `organization_id`; list/read handlers reject cross-org access with `404`.

## Concurrency

Concurrent membership changes, invite+accept, and cross-org quota consumption
are safe: `addMember` is idempotent (UNIQUE-safe), and quota pools are isolated
per org (`org-security-concurrency`).

## Regression guarantees

The feature is additive. The following anchors prove legacy behavior is
unchanged:

- `org-compat-personal-routing` — plain models still route personally.
- `org-compat-api-key` — personal API-key auth still works.
- `org-compat-remote-token` — management tokens still work.
- `org-compat-migration` — migrations are additive/idempotent.
