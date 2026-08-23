/**
 * 03-platform-user-admin / Task 07 — block/unblock action UI helper.
 *
 * TDD: fails before nextBlockActionStatus/blockActionLabel exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { nextBlockActionStatus, blockActionLabel } from "../../src/lib/auth/userBlockActions.ts";

test("active user -> block action targets 'blocked'", () => {
  assert.equal(nextBlockActionStatus("active"), "blocked");
  assert.equal(blockActionLabel("active"), "block");
});

test("blocked user -> unblock action targets 'active'", () => {
  assert.equal(nextBlockActionStatus("blocked"), "active");
  assert.equal(blockActionLabel("blocked"), "unblock");
});

test("disabled user -> unblock action restores 'active'", () => {
  assert.equal(nextBlockActionStatus("disabled"), "active");
  assert.equal(blockActionLabel("disabled"), "unblock");
});

test("unknown status -> unblock to active (safe)", () => {
  assert.equal(nextBlockActionStatus("weird"), "active");
  assert.equal(blockActionLabel("weird"), "unblock");
});
