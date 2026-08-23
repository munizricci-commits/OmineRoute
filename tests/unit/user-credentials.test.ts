/**
 * 04-registration / Task 02 — per-user password credential hashing.
 *
 * TDD: fails before userCredentials module exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { setUserPassword, verifyUserPassword, hasUserPassword } from "@/lib/db/userCredentials";
import * as usersDb from "@/lib/db/users";

test("set then verify a password (round-trip)", async () => {
  const u = await usersDb.createUser({ role: "user" });
  await setUserPassword(u.id, "correct horse battery");
  assert.equal(await verifyUserPassword(u.id, "correct horse battery"), true);
  assert.equal(await verifyUserPassword(u.id, "wrong"), false);
  assert.equal(await hasUserPassword(u.id), true);
});

test("short password is rejected", async () => {
  const u = await usersDb.createUser({ role: "user" });
  await assert.rejects(() => setUserPassword(u.id, "short"));
});

test("verify returns false for unknown user", async () => {
  assert.equal(await verifyUserPassword("does-not-exist", "x"), false);
  assert.equal(await hasUserPassword("does-not-exist"), false);
});
