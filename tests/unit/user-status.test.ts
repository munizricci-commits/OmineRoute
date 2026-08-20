/**
 * 03-platform-user-admin / Task 05 — active/blocked account status normalization.
 *
 * TDD: fails before normalizeUserStatus exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUserStatus } from "../../src/lib/auth/userStatus.ts";

test("explicit active stays active", () => {
  assert.equal(normalizeUserStatus("active"), "active");
});

test("explicit blocked stays blocked", () => {
  assert.equal(normalizeUserStatus("blocked"), "blocked");
});

test("unknown value defaults to active (safe default)", () => {
  assert.equal(normalizeUserStatus("deleted"), "active");
  assert.equal(normalizeUserStatus("suspended"), "active");
});

test("null/undefined defaults to active (safe default)", () => {
  assert.equal(normalizeUserStatus(null), "active");
  assert.equal(normalizeUserStatus(undefined), "active");
  assert.equal(normalizeUserStatus(""), "active");
});
