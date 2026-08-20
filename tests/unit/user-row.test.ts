/**
 * 03-platform-user-admin / Task 02 — users table normalization helper.
 *
 * TDD: fails before userSummaryLabel exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { userSummaryLabel } from "../../src/lib/auth/userRow.ts";

const base = {
  id: "u-1",
  email: null,
  displayName: null,
  loginIdentifier: null,
  role: "user",
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

test("prefers displayName", () => {
  assert.equal(userSummaryLabel({ ...base, displayName: "Alice" }), "Alice");
});

test("falls back to loginIdentifier", () => {
  assert.equal(userSummaryLabel({ ...base, loginIdentifier: "alice" }), "alice");
});

test("falls back to email", () => {
  assert.equal(userSummaryLabel({ ...base, email: "alice@example.com" }), "alice@example.com");
});

test("falls back to id when nothing else", () => {
  assert.equal(userSummaryLabel(base), "u-1");
});
