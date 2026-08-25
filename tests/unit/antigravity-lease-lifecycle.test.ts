import test from "node:test";
import assert from "node:assert/strict";
const state = await import("../../src/sse/services/antigravityRoutingState.ts");
const lifecycle = await import("../../src/sse/services/antigravityLeaseLifecycle.ts");
test.beforeEach(() => state.__resetAntigravityRoutingStateForTests());
function acquire() { const r = state.tryAcquireAntigravityLease({ connectionId: "a", requestedModel: "gemini-3-flash-agent" }); assert.equal(r.kind, "acquired"); if (r.kind !== "acquired") throw Error(); return r.lease; }
test("SSE lease releases on EOF and cancel", async () => {
  const lease = acquire(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = lifecycle.holdAntigravityLeaseThroughResponse(new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "content-type": "text/event-stream" } }), lease.id, null);
  assert.equal(state.getAntigravityLeaseAvailability({ connectionId: "a", requestedModel: "gemini-3.5-flash-high" }).available, false);
  const reader = response.body!.getReader(); controller.close(); await reader.read();
  assert.equal(state.getAntigravityLeaseAvailability({ connectionId: "a", requestedModel: "gemini-3.5-flash-high" }).available, true);
  const second = acquire(); const cancelled = lifecycle.holdAntigravityLeaseThroughResponse(new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } }), second.id, null); await cancelled.body!.cancel();
  assert.equal(state.getAntigravityLeaseAvailability({ connectionId: "a", requestedModel: "gemini-3-flash-agent" }).available, true);
});
test("reasoning rejection frees selector-owned lease", async () => {
 const lease = acquire(); await assert.rejects(lifecycle.releaseAntigravityLeaseOnPreDispatchError(lease.id, async () => { throw Error("reasoning failed"); }));
 assert.equal(state.getAntigravityLeaseAvailability({ connectionId: "a", requestedModel: "gemini-3-flash-agent" }).available, true);
});
