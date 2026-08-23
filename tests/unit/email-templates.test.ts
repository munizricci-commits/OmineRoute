/**
 * 05-email-smtp / Task 05 — minimal versioned email templates.
 *
 * TDD: fails before lib/email/templates.ts exists, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  renderVerificationEmail,
  renderInvitationEmail,
  renderPasswordResetEmail,
  EMAIL_TEMPLATE_VERSION,
} from "@/lib/email/templates";

test("verification template renders subject, text and html with the link", () => {
  const m = renderVerificationEmail({ link: "https://x.io/verify?t=abc", displayName: "Jane" });
  assert.match(m.subject, /verify/i);
  assert.ok(m.text.includes("https://x.io/verify?t=abc"));
  assert.ok(m.html.includes("https://x.io/verify?t=abc"));
  assert.ok(m.html.startsWith("<"));
});

test("invitation template includes org and invite link", () => {
  const m = renderInvitationEmail({
    link: "https://x.io/invite?c=xyz",
    orgName: "Acme",
    inviter: "Bob",
  });
  assert.match(m.subject, /invit/i);
  assert.ok(m.text.includes("Acme"));
  assert.ok(m.text.includes("https://x.io/invite?c=xyz"));
});

test("password reset template includes the reset link and no raw token leak in subject", () => {
  const m = renderPasswordResetEmail({ link: "https://x.io/reset?t=tok123", login: "jane" });
  assert.match(m.subject, /reset/i);
  assert.ok(m.text.includes("https://x.io/reset?t=tok123"));
  assert.ok(!m.subject.includes("tok123"));
});

test("templates carry a version marker", () => {
  assert.equal(typeof EMAIL_TEMPLATE_VERSION, "string");
  assert.ok(EMAIL_TEMPLATE_VERSION.length > 0);
});
