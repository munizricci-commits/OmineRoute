// #503-fanout: the ingest byte-budget gate must be pressure-driven, not
// unconditional. `normal` admits within budget (bounded wait capped short);
// `high` uses the caller's full bounded wait; `critical` sheds before any
// bytes are even ingested. This is the counterpart to
// agent-fanout-admission-regression.test.ts, focused on the pressure
// dimension rather than the fan-out/concurrency dimension.
import test from "node:test";
import assert from "node:assert/strict";

const { ChatAdmissionController, admitChatRequest } = await import(
  "../../src/shared/middleware/chatBodyAdmission.ts"
);

const silentSink = () => {};

function bodyOf(bytes: number): string {
  return "x".repeat(bytes);
}

function requestFor(body: string): Request {
  return new Request("http://x/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(body.length) },
    body,
  });
}

test("normal pressure: a request within the byte budget is admitted", async () => {
  const controller = new ChatAdmissionController(Number.MAX_SAFE_INTEGER, undefined, 0, silentSink, {
    maxInflightBytes: 1024 * 1024,
    checkPressureSeverity: () => "normal",
  });

  const result = await admitChatRequest(requestFor(bodyOf(4096)), {
    controller,
    largeBodyBytes: 1024,
    hardMaxBytes: 10 * 1024 * 1024,
    queueMs: 5000,
  });

  assert.equal(result.admit, true);
  if (result.admit) result.lease?.release();
});

test("normal pressure: an over-budget request sheds quickly (bounded to ~250ms), not the full queueMs", async () => {
  const controller = new ChatAdmissionController(Number.MAX_SAFE_INTEGER, undefined, 0, silentSink, {
    maxInflightBytes: 1024, // smaller than the body below
    checkPressureSeverity: () => "normal",
  });

  const start = Date.now();
  const result = await admitChatRequest(requestFor(bodyOf(4096)), {
    controller,
    sessionId: "budget-exhausted",
    largeBodyBytes: 1024,
    hardMaxBytes: 10 * 1024 * 1024,
    queueMs: 5000, // if this were honored in full, the assertion below would fail
  });
  const elapsedMs = Date.now() - start;

  assert.equal(result.admit, false);
  if (!result.admit) assert.equal(result.response.status, 503);
  assert.ok(
    elapsedMs < 2000,
    `normal pressure must cap the ingest wait well under the full queueMs (took ${elapsedMs}ms)`
  );
});

test("high pressure: an over-budget request waits up to the full queueMs before shedding", async () => {
  const controller = new ChatAdmissionController(Number.MAX_SAFE_INTEGER, undefined, 0, silentSink, {
    maxInflightBytes: 1024,
    checkPressureSeverity: () => "high",
  });

  const start = Date.now();
  const result = await admitChatRequest(requestFor(bodyOf(4096)), {
    controller,
    sessionId: "high-pressure-wait",
    largeBodyBytes: 1024,
    hardMaxBytes: 10 * 1024 * 1024,
    queueMs: 300,
  });
  const elapsedMs = Date.now() - start;

  assert.equal(result.admit, false);
  assert.ok(elapsedMs >= 280, `high pressure must honor the full bounded wait (took ${elapsedMs}ms)`);
});

test("high pressure: budget freed mid-wait is claimed instead of shedding", async () => {
  const controller = new ChatAdmissionController(Number.MAX_SAFE_INTEGER, undefined, 0, silentSink, {
    maxInflightBytes: 4096,
    checkPressureSeverity: () => "high",
  });

  // Occupy the entire budget first.
  const occupied = controller.tryAcquireBudget(4096);
  assert.ok(occupied);

  const pending = admitChatRequest(requestFor(bodyOf(2048)), {
    controller,
    sessionId: "high-pressure-freed",
    largeBodyBytes: 1024,
    hardMaxBytes: 10 * 1024 * 1024,
    queueMs: 2000,
  });

  setTimeout(() => occupied.release(), 30);
  const result = await pending;
  assert.equal(result.admit, true, "freeing budget mid-wait must let the waiter through");
  if (result.admit) result.lease?.release();
});

test("critical pressure: the whole request is shed before ingestion, with a distinct code", async () => {
  const controller = new ChatAdmissionController(Number.MAX_SAFE_INTEGER, undefined, 0, silentSink, {
    maxInflightBytes: 1024 * 1024 * 1024, // budget is not the limiting factor here
    checkPressureSeverity: () => "critical",
  });

  const result = await admitChatRequest(requestFor(bodyOf(64)), {
    controller,
    sessionId: "critical-shed",
    largeBodyBytes: 1024,
    hardMaxBytes: 10 * 1024 * 1024,
    queueMs: 5000,
  });

  assert.equal(result.admit, false);
  if (!result.admit) {
    assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get("Retry-After"), "2");
    const payload = await result.response.json();
    assert.equal(payload.error.code, "resource_pressure");
  }
  assert.deepEqual(controller.shedsByReason, { resource_pressure: 1 });
});

test("pressureSeverity() defaults to normal for a controller with no injected probe", () => {
  const controller = new ChatAdmissionController(1);
  assert.equal(controller.pressureSeverity(), "normal");
  assert.equal(controller.maxInflightBytes, Number.MAX_SAFE_INTEGER);
});
