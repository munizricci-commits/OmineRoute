/**
 * 09-security-hardening / Task 05 — authentication endpoint abuse controls (TDD, unit).
 *
 * Exercises the existing login brute-force guard: after FAILURE_THRESHOLD failures
 * within the window from one client, further attempts are locked out with a
 * retry-after; a successful reset clears the lockout; the guard is a no-op when
 * disabled. This is the abuse control that pairs with proxy-level rate limiting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkLoginGuard,
  recordLoginFailure,
  clearLoginAttempts,
  resetLoginGuardForTests,
} from "../../src/server/auth/loginGuard.ts";

test.beforeEach(() => resetLoginGuardForTests());
test.after(() => resetLoginGuardForTests());

test("lockout engages after threshold failures and reports retry-after", () => {
  const ip = "1.2.3.4";
  let last: { allowed: boolean; retryAfterSeconds?: number } = { allowed: true };
  for (let i = 0; i < 5; i++) {
    last = recordLoginFailure(ip, { enabled: true });
  }
  assert.equal(last.allowed, false);
  assert.ok(last.retryAfterSeconds && last.retryAfterSeconds > 0);

  // While locked, checkLoginGuard refuses.
  const check = checkLoginGuard(ip, { enabled: true });
  assert.equal(check.allowed, false);
});

test("a successful reset clears the lockout", () => {
  const ip = "5.6.7.8";
  for (let i = 0; i < 5; i++) recordLoginFailure(ip, { enabled: true });
  assert.equal(checkLoginGuard(ip, { enabled: true }).allowed, false);
  clearLoginAttempts(ip);
  assert.equal(checkLoginGuard(ip, { enabled: true }).allowed, true);
});

test("guard is a no-op when disabled", () => {
  const ip = "9.9.9.9";
  for (let i = 0; i < 10; i++) recordLoginFailure(ip, { enabled: false });
  assert.equal(checkLoginGuard(ip, { enabled: false }).allowed, true);
});
