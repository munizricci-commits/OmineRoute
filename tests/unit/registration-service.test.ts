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
