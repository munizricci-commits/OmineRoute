# Organizations — PR decomposition

The Organizations feature was built in the `feature/organizations-layer` branch
off `release/v3.8.50`. For upstream review, decompose into reviewable PRs with
minimal mixed concerns. Each PR is independently testable and keeps tests with
the code it proves.

## Suggested PR sequence

| #   | PR title (scope)                                   | Contents                                                                             | Test anchor                                              |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | `feat(org): identity + principal`                  | `users.ts` key↔user linkage, `resolveDashboardUserPrincipal`, `platform_admin` role. | `org-identity`                                           |
| 2   | `feat(org): organizations + members + invitations` | `organizations.ts`, `members.ts`, `invitations.ts`, migrations 155.                  | `org-organizations`, `org-membership`, `org-invitations` |
| 3   | `feat(org): fail-closed authorization`             | `authorization.ts`, `apiAuth.ts`, `principal.ts` types/policy.                       | `org-authorization`                                      |
| 4   | `feat(org): org-scoped connections`                | `orgConnections.ts`, migration 158, secret redaction.                                | `org-connections`                                        |
| 5   | `feat(org): org-scoped combos`                     | `orgCombos.ts`, migration 159, combo validation.                                     | `org-combos`                                             |
| 6   | `feat(org): qualified routes`                      | `qualifiedRoute.ts`, chat/completions wiring, mgmt-token parity.                     | `org-route-resolution`, `org-chat-combo`                 |
| 7   | `feat(org): auto routing scope`                    | `autoScope.ts`, `virtualFactory`/`autoRouting` scope threading.                      | `org-auto-*`                                             |
| 8   | `feat(org): organizations API + dashboard`         | `orgApiService.ts`, `/api/v1/organizations/**`, dashboard UI.                        | `org-api`, `org-dashboard`                               |
| 9   | `feat(org): org quota`                             | `orgQuotas.ts`, migration 161, `orgQuotaEnforcement.ts`, `/[id]/quota`.              | `org-quota-*`                                            |
| 10  | `test(org): compatibility + security regressions`  | `org-compat-*`, `org-security-*`, `org-perf-*`, `org-ci-static`.                     | 225/225 org suite                                        |

## Concerns kept separate

- **Migrations** ship with their domain module (PRs 2/4/5/9), never standalone.
- **No production logic in `localDb.ts`** — only re-exports (added for P11.05:
  `resolveDashboardUserPrincipal`, `getOrganizationConnections`,
  `createOrganizationConnection`).
- **No second routing engine** — qualified routes reuse `auto`/`combo` (P6/P7).
- **`MANAGEMENT_API_KEY_SCOPES` untouched** (P10.03 anchor).

## Review gates

Each PR must pass: lint (`npm run lint`), typecheck (`npm run typecheck:core`),
unit tests (`npm run test:unit`), and the org suite
(`node --import tsx/esm --test tests/unit/org-*.test.ts`). Full suite
`225/225` green on the branch tip before merge.
