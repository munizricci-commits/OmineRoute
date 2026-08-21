/**
 * 02-multi-user-mode — registration-policy visibility (integration).
 *
 * TDD guard: the public GET /api/auth/instance-settings must return the
 * registration-relevant flags (multiUserEnabled, registrationPolicy) WITHOUT
 * requiring authentication, so the /login page can decide whether to show the
 * "Register" control for an unauthenticated visitor. The payload carries only
 * non-sensitive policy flags (no credentials), so exposing it is safe.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-instance-public-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const route = await import("../../src/app/api/auth/instance-settings/route.ts");

function reqNoAuth(): Request {
  return new Request("http://localhost/api/auth/instance-settings", { method: "GET" });
}

test.beforeEach(async () => {
  core.resetDbInstance();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("GET without auth returns public registration policy (200, no credentials)", async () => {
  const res = await route.GET(reqNoAuth());
  assert.equal(res.status, 200, "unauthenticated GET must succeed (public policy)");

  const body = (await res.json()) as {
    settings?: { multiUserEnabled?: boolean; registrationPolicy?: string };
  };
  assert.ok(body.settings, "body.settings present");
  // Non-sensitive policy flags must be present.
  assert.equal(typeof body.settings!.multiUserEnabled, "boolean");
  assert.ok(["disabled", "invite-only"].includes(body.settings!.registrationPolicy!));
  // Fresh DB defaults: multi-user off, registration disabled.
  assert.equal(body.settings!.multiUserEnabled, false);
  assert.equal(body.settings!.registrationPolicy, "disabled");
});
