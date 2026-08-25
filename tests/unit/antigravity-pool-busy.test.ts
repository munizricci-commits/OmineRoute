import test from "node:test";
import assert from "node:assert/strict";
const chat = await import("../../src/sse/handlers/chat.ts");
test("POOL_BUSY is structured 503 with a positive Retry-After", async () => {
  const response = chat.buildAntigravityPoolBusyResponse(Date.now() + 1_250);
  assert.equal(response.status, 503);
  assert.ok(Number(response.headers.get("Retry-After")) >= 1);
  assert.equal((await response.json()).error.code, "POOL_BUSY");
});
