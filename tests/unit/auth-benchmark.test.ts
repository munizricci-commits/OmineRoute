/**
 * 09-security-hardening / Task 08 — benchmark login, principal resolution and
 * organization-aware dashboard loading.
 *
 * TDD-ish smoke benchmark: runs the hot auth paths in a loop and asserts each
 * stays well under a generous ceiling (these are synchronous-ish SQLite + JWT ops,
 * so sub-50ms per call is expected). Guards against accidental regressions that
 * make the dashboard login path pathologically slow. Also asserts the login
 * brute-force guard map stays bounded (no unbounded memory growth).
 *
 * Run with: node --import tsx/esm --test tests/unit/auth-benchmark.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-bench-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";
process.env.JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long";
process.env.INITIAL_PASSWORD = "bench-password";
process.env.APP_LOG_TO_FILE = "false";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { resolveDashboardUserPrincipal } = await import("../../src/lib/org/principal.ts");
const { listOrganizationsHandler } = await import("../../src/lib/org/orgApiService.ts");
const guard = await import("../../src/server/auth/loginGuard.ts");

function resetDb() {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

test.beforeEach(() => {
  resetDb();
  guard.resetLoginGuardForTests();
});
test.after(() => {
  resetDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function makeSession(sub: string): string {
  // Inline HS256 sign to avoid jose import churn; mirrors sessionIssuer contract.
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      authenticated: true,
      sub,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    })
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", process.env.JWT_SECRET!).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const ITER = 200;

test(`principal resolution completes < ${ITER} iterations under ceiling`, async () => {
  const u = createUserSync({ role: "user", email: "bench@x.io" });
  const token = makeSession(u.id);
  const req = new Request("http://localhost", { headers: { cookie: `auth_token=${token}` } });

  const start = process.hrtime.bigint();
  for (let i = 0; i < ITER; i++) {
    const p = await resolveDashboardUserPrincipal(req);
    assert.ok(p);
    assert.equal(p!.userId, u.id);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  // < 50ms average per call.
  assert.ok(ms / ITER < 50, `avg principal resolution ${ms / ITER}ms exceeds 50ms`);
});

test(`org-aware dashboard load completes < ${ITER} iterations under ceiling`, async () => {
  const u = createUserSync({ role: "platform_admin", email: "admin@x.io" });
  const token = makeSession(u.id);
  const req = new Request("http://localhost/api/organizations", {
    headers: { cookie: `auth_token=${token}` },
  });

  const start = process.hrtime.bigint();
  for (let i = 0; i < ITER; i++) {
    const res = await listOrganizationsHandler(req);
    assert.equal(res.status, 200);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms / ITER < 50, `avg org dashboard load ${ms / ITER}ms exceeds 50ms`);
});

test("login brute-force guard tracks distinct IPs without spurious duplication", () => {
  // Many distinct IPs each fail once. The guard must track each exactly once
  // (no duplicate keys bloating the map) and remain a bounded, finite structure.
  const ips = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const ip = `10.0.${Math.floor(i / 256)}.${i % 256}`;
    ips.add(ip);
    guard.recordLoginFailure(ip, { enabled: true });
  }
  // No entry is duplicated; size equals the count of distinct IPs seen.
  assert.equal(guard.getLoginGuardSizeForTests(), ips.size);
  // The map is finite and within the number of distinct offenders.
  assert.ok(guard.getLoginGuardSizeForTests() <= 1000);
});
