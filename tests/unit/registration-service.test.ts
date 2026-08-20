/**
 * 04-registration / Task 02 — registration/acceptance service (validation + tx + policy).
 *
 * TDD: fails before acceptRegistration exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { acceptRegistration, RegistrationError } from "@/lib/auth/registrationService";
import { setInstanceAuthSettings, getInstanceAuthSettings } from "@/lib/db/instanceAuthSettings";
import { verifyUserPassword } from "@/lib/db/userCredentials";

test("disabled policy rejects registration", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "disabled" });
  await assert.rejects(() => acceptRegistration({ password: "longenoughpw" }), RegistrationError);
  assert.equal((await getInstanceAuthSettings()).registrationPolicy, "disabled");
});

test("invite-only without code rejects", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  await assert.rejects(
    () => acceptRegistration({ password: "longenoughpw" }),
    (e) => e instanceof RegistrationError && e.code === "INVITE_REQUIRED"
  );
});

test("invite-only with code creates user + credential atomically", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const user = await acceptRegistration({
    loginIdentifier: "New.User_1",
    email: "new@example.com",
    password: "longenoughpw",
    inviteCode: "abc-123",
  });
  assert.equal(user.role, "user");
  assert.equal(user.loginIdentifier, "new.user_1"); // normalized
  assert.equal(user.email, "new@example.com");
  // password actually persisted and verifiable
  assert.equal(await verifyUserPassword(user.id, "longenoughpw"), true);
  assert.equal(await verifyUserPassword(user.id, "wrong"), false);
});

test("invalid input (short password) rejected", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  await assert.rejects(
    () => acceptRegistration({ password: "short", inviteCode: "x" }),
    (e) => e instanceof RegistrationError && e.code === "INVALID_INPUT"
  );
});

test("password from denylist rejected with WEAK_PASSWORD", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  await assert.rejects(
    () => acceptRegistration({ password: "password", inviteCode: "x" }),
    (e) => e instanceof RegistrationError && e.code === "WEAK_PASSWORD"
  );
});

test("duplicate loginIdentifier is rejected without revealing which field (DUPLICATE)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const first = await acceptRegistration({
    loginIdentifier: "Dup.User",
    password: "longenoughpw",
    inviteCode: "x",
  });
  assert.equal(first.loginIdentifier, "dup.user");
  await assert.rejects(
    () =>
      acceptRegistration({
        loginIdentifier: "dup.user", // case-insensitive collision
        password: "anotherpw1",
        inviteCode: "x",
      }),
    (e) => e instanceof RegistrationError && e.code === "DUPLICATE"
  );
});

test("duplicate email is rejected without revealing which field (DUPLICATE)", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  await acceptRegistration({
    email: "dup@example.com",
    password: "longenoughpw",
    inviteCode: "x",
  });
  await assert.rejects(
    () =>
      acceptRegistration({
        email: "DUP@example.com", // case-insensitive collision
        password: "anotherpw1",
        inviteCode: "x",
      }),
    (e) => e instanceof RegistrationError && e.code === "DUPLICATE"
  );
});

test("registered user exists without any organization membership", async () => {
  await setInstanceAuthSettings({ registrationPolicy: "invite-only" });
  const user = await acceptRegistration({
    loginIdentifier: "Orgless.User",
    email: "orgless@example.com",
    password: "longenoughpw",
    inviteCode: "x",
  });
  // The user was created.
  assert.ok(user.id);
  // But they are NOT auto-assigned to any organization (Task 06).
  const { getUserMemberships } = await import("@/lib/db/members");
  const memberships = await getUserMemberships(user.id);
  assert.equal(memberships.length, 0);
});
