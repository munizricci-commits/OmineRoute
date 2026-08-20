/**
 * 05-email-smtp / Task 01 — minimal email delivery abstraction (pure module).
 *
 * TDD: fails before lib/email/{types,noopTransport,service}.ts exist, then passes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { NoopEmailTransport } from "@/lib/email/noopTransport";
import { EmailService } from "@/lib/email/service";
import type { EmailMessage } from "@/lib/email/types";

const sample: EmailMessage = {
  to: "user@example.com",
  subject: "Verify your account",
  text: "Click the link to verify.",
  html: "<p>Click the link to verify.</p>",
};

test("NoopEmailTransport accepts a message and reports success without sending", async () => {
  const transport = new NoopEmailTransport();
  const res = await transport.send(sample);
  assert.equal(res.ok, true);
  assert.equal(res.transport, "noop");
});

test("EmailService defaults to the noop transport and does not throw", async () => {
  const svc = new EmailService({ transport: new NoopEmailTransport() });
  const res = await svc.send(sample);
  assert.equal(res.ok, true);
  // A secret (the recipient) is never placed in the result error/cause fields.
  assert.ok(!("password" in (res as Record<string, unknown>)));
});

test("EmailService.send validates a well-formed message", async () => {
  const svc = new EmailService({ transport: new NoopEmailTransport() });
  await assert.doesNotReject(() => svc.send(sample));
  // Missing `to` must be rejected by the service contract.
  await assert.rejects(() => svc.send({ ...sample, to: "" } as EmailMessage), /to/i);
});
