import test from "node:test";
import assert from "node:assert/strict";

const state = await import("../../src/sse/services/antigravityRoutingState.ts");

test.beforeEach(() => state.__resetAntigravityRoutingStateForTests());

test("lease key is connection plus canonical exact model", () => {
  const first = state.tryAcquireAntigravityLease({
    connectionId: "account-a",
    requestedModel: "gemini-3-pro-preview",
    requestId: "request-a",
    now: 1_000,
  });
  assert.equal(first.kind, "acquired");
  if (first.kind !== "acquired") return;
  assert.equal(first.lease.exactModel, "gemini-3.1-pro");

  assert.deepEqual(
    state.tryAcquireAntigravityLease({
      connectionId: "account-a",
      requestedModel: "gemini-3.1-pro",
      now: 1_001,
    }),
    { kind: "busy", earliestExpiryMs: first.lease.expiresAtMs }
  );
  assert.equal(
    state.tryAcquireAntigravityLease({
      connectionId: "account-b",
      requestedModel: "gemini-3.1-pro",
      now: 1_001,
    }).kind,
    "acquired"
  );
});

test("release is fenced and explicit release restores availability", () => {
  const acquired = state.tryAcquireAntigravityLease({
    connectionId: "account-a",
    requestedModel: "gemini-3.5-flash-high",
    requestId: "request-a",
    deadlineMs: 1_010,
    now: 1_000,
  });
  assert.equal(acquired.kind, "acquired");
  if (acquired.kind !== "acquired") return;

  assert.equal(state.releaseAntigravityLease("wrong-lease"), false);
  assert.deepEqual(
    state.getAntigravityLeaseAvailability({
      connectionId: "account-a",
      requestedModel: "gemini-3-flash-agent",
      now: 1_001,
    }),
    { available: false, earliestExpiryMs: acquired.lease.expiresAtMs }
  );
  assert.equal(state.releaseAntigravityLease(acquired.lease.id), true);
  assert.deepEqual(
    state.getAntigravityLeaseAvailability({
      connectionId: "account-a",
      requestedModel: "gemini-3-flash-agent",
      now: 1_001,
    }),
    { available: true }
  );
});
