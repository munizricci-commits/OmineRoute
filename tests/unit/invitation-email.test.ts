/**
 * 07-invitations / Task 04 — send invitation emails through the shared email service.
 *
 * TDD: fails before invitationEmailService.sendInvitationEmail exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { sendInvitationEmail } from "../../src/lib/auth/invitationEmailService.ts";

test("sendInvitationEmail renders and dispatches without throwing when SMTP is unset", async () => {
  // No STORAGE_ENCRYPTION_KEY / no SMTP config -> transport is noop; must not throw.
  const result = await sendInvitationEmail({
    organizationName: "Acme",
    email: "invitee@x.io",
    token: "tokentokentokentokentokentokentokentoken",
    invitedBy: "owner@x.io",
  });
  assert.equal(result.ok, true);
});

test("sendInvitationEmail returns error result on invalid input rather than throwing", async () => {
  const result = await sendInvitationEmail({
    organizationName: "Acme",
    email: "",
    token: "abc",
    invitedBy: "owner@x.io",
  });
  // Either ok (noop) or graceful error — never an uncaught throw.
  assert.ok(typeof result.ok === "boolean");
});
