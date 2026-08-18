# Organizations — release checklist

Final pre-merge / pre-release verification for the Organizations feature.

## Migration

- [x] Migrations 155, 158, 159, 161 are additive (new table / new column).
- [x] Idempotent — re-running on a fresh DB is a no-op (anchor: `org-compat-migration`).
- [x] No legacy table altered or dropped.
- [ ] **Rollback**: to disable, the new `organization_*` tables/columns are inert
      until an org is created; no data migration of existing personal rows is
      required. Rollback = revert the code; the additive schema can remain.

## Security

- [x] Authorization fail-closed (`resolveOrgAccess` → 404/403; default deny).
- [x] Cross-tenant isolation: routing, quota, resources (anchors:
      `org-security-cross-org`, `org-security-concurrency`).
- [x] No credential disclosure (anchor: `org-security-secret-redaction`).
- [x] Error bodies sanitized (no raw stack) — `buildErrorBody` / `sanitizeErrorMessage`.
- [x] UI visibility is not a security boundary — API re-checks every call.

## Compatibility (additive)

- [x] Personal routing unchanged (anchor: `org-compat-personal-routing`).
- [x] Personal API-key auth unchanged (anchor: `org-compat-api-key`).
- [x] Remote/management tokens unchanged (anchor: `org-compat-remote-token`).
- [x] `MANAGEMENT_API_KEY_SCOPES` untouched.

## Performance

- [x] Org scope resolution bounded (<2s for 50 org connections); pool enumerated
      once, no N+1 (anchor: `org-perf-routing`).

## Manual smoke test

1. Create an organization as a dashboard user (owner).
2. Invite a second user; accept; confirm role `user`.
3. Add an org connection (owner/moderator only); confirm a `user` viewer sees it
   without the secret.
4. Create an org combo; call `team1/combo:dev` as a member → success.
5. As a non-member, call `team1/combo:dev` → 404; call `team2/combo:dev` → 404.
6. Set an org quota (owner/moderator); confirm over-limit pre-request block.
7. Plain model `gpt-4` (no `/`) still routes personally.

## CI

- [x] `npm run lint` clean on org files (husky pre-commit passed on all commits).
- [x] `npm run typecheck:core` covers org modules (anchor: `org-ci-static`).
- [x] `node --import tsx/esm --test tests/unit/org-*.test.ts` → **225/225 pass**.

## Notes / risks

- The `management-policy.test.ts`, `rtk-learn-discover-routes.test.ts`,
  `client-api-policy-fallback.test.ts`, `db/omp.test.ts` failures in the broad
  sweep are **pre-existing** (reproduced on `release/v3.8.50`) and unrelated to
  this feature (Windows `EPERM` temp-dir cleanup / file-level teardown). Not a
  regression.
