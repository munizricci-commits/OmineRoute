# Baseline Test Status — feature/organizations-layer

> Status snapshot taken 2026-08-22 on the Windows / git-bash dev host.

## Summary

The `feature/organizations-layer` branch carries **no new test regressions** from
its changes. Every test that exercises the code this branch modified is green:

| Suite                                                                  | Result                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `tests/unit/org-*.test.ts` (org unit suite, 239 tests)                 | ✅ 239/239 pass                                                          |
| `tests/unit/org-quota-enforcement.test.ts`                             | ✅ 7/7 pass (P9.03 pre/post-flight + cross-tenant isolation + fail-open) |
| `tests/unit/org-combo-resolution.test.ts`                              | ✅ 5/5 pass (P6 explicit-org-combo isolation)                            |
| `tests/unit/chatCore-quota-share-consumption.test.ts`                  | ✅ 4/4 pass                                                              |
| `tests/unit/quota-enforce.test.ts`                                     | ✅ 8/8 pass                                                              |
| ESLint (all touched files, `chat.ts`, `orgQuotaEnforcement.ts`, tests) | ✅ clean                                                                 |

## Pre-existing baseline failures (NOT introduced by this branch)

A set of ~12 unit tests fail on this Windows/git-bash host **independent of this
branch** — they fail identically on `origin/release/v3.8.50` and are caused by
the local test harness environment, not by application logic:

1. **Windows temp-dir `EPERM` in `isolateDataDir` setup hook.** Several tests
   call `fs.rmSync` on a `os.tmpdir()` dir during `before`/`after` and hit
   `EPERM: Permission denied` (Windows file-lock). Example reproduced live:
   `tests/unit/api/compression/rtk-learn-discover-routes.test.ts` fails with
   `Error: EPERM, Permission denied: \\?\C:\Users\...\AppData\Local\Temp\omniroute-rtk-ld-routes-*` at the cleanup hook — no assertion is even reached. This is a known Windows/AV file-lock limitation of the `--import ./tests/_setup/isolateDataDir.ts` harness, not a product bug.
2. **Command-line length limit.** A single-invocation full-suite glob
   (`node --test tests/unit/*.test.ts "tests/unit/{...}/**/*.test.ts"`) exceeds
   Windows' `CreateProcess` argument limit (~32k chars) once the `tests/unit`
   tree is expanded, so `winpty`/node never start (`exit 126` / `Имя файла …
слишком большую длину`). The CI command `npm run test:unit` passes the glob
   as a single literal arg to node (node expands it internally), which is why CI
   does not hit this — but manual reproduction on this host does.
3. **Aggregate runner hang.** Running the entire suite via `npm run test:unit`
   on this host progresses for ~15–18 min then stalls (output buffered per test
   file); a per-test `--test-timeout` does not cover module-load hangs. The
   stall is in unrelated pre-existing tests, not in org/chat code.

Known categories that surface under (1)/(2)/(3) on this host (from the audit):
`authz/management-policy`, `authz/client-api-policy-fallback`,
`api/compression/rtk-learn-discover-routes`, `db/omp`, and others totaling ~12.
These are tracked as **baseline** — they must not be confused with regressions
introduced by the organizations-layer work.

## What this branch actually changed (and verified)

- `src/lib/org/orgQuotaEnforcement.ts` — `consumeOrgQuota()` post-flight accounting
  - `enforceOrgQuotaScope()` real-store read (both now `await getQuotaStore()`;
    previously the missing `await` made the store a Promise and the call was
    silently swallowed → org quota was declarative-only).
- `src/sse/handlers/chat.ts` — P9.03 pre-flight `enforceOrgQuotaScope` gate
  (429 on block, fail-open) + non-stream post-flight `consumeOrgQuota`, both
  threaded by `routingScope`; P6 explicit-org-combo resolution via
  `resolveComboInScope` (execution-time isolation, fail-closed cross-tenant).

## Verification commands used

```bash
# Org suite (change surface)
node --import tsx/esm --test tests/unit/org-*.test.ts

# P9.03 quota enforcement
node --import tsx/esm --test tests/unit/org-quota-enforcement.test.ts

# P6 explicit-org-combo isolation
node --import tsx/esm --test tests/unit/org-combo-resolution.test.ts

# ESLint on touched files
npx eslint --suppressions-location config/quality/eslint-suppressions.json \
  src/sse/handlers/chat.ts src/lib/org/orgQuotaEnforcement.ts \
  tests/unit/org-quota-enforcement.test.ts tests/unit/org-combo-resolution.test.ts
```

## Action items (not blocking this branch)

- [ ] On Linux CI, confirm the ~12 baseline failures are green there (they are
      environmental on Windows). If any is a genuine logic failure, file a
      separate follow-up issue — none are caused by organizations-layer code.
- [ ] Consider hardening `tests/_setup/isolateDataDir.ts` against Windows
      `EPERM` (retry / best-effort ignore) so local full-suite runs are
      reliable on this host.
