import { test } from "node:test";
import assert from "node:assert/strict";
import { OpencodeExecutor } from "../../open-sse/executors/opencode.ts";

test("OpencodeExecutor.transformRequest does not truncate tools beyond 128 (#11444)", () => {
  const executor = new OpencodeExecutor();
  const toolCount = 160;
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    type: "function",
    function: { name: `tool_${i}`, description: `Tool ${i}`, parameters: {} },
  }));

  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "hello" }],
    tools,
  };

  const result = executor.transformRequest(
    "deepseek-chat",
    body,
    false,
    { apiKey: "test-key" }
  );

  assert.equal(
    result.tools.length,
    toolCount,
    `Expected all ${toolCount} tools to pass through, but got ${result.tools.length}`
  );
});

test("OpencodeExecutor.transformRequest preserves tools at exactly 128", () => {
  const executor = new OpencodeExecutor();
  const tools = Array.from({ length: 128 }, (_, i) => ({
    type: "function",
    function: { name: `tool_${i}`, description: `Tool ${i}`, parameters: {} },
  }));

  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "hello" }],
    tools,
  };

  const result = executor.transformRequest(
    "deepseek-chat",
    body,
    false,
    { apiKey: "test-key" }
  );

  assert.equal(result.tools.length, 128);
});

test("OpencodeExecutor.transformRequest preserves tools well above 128 (#9132)", () => {
  const executor = new OpencodeExecutor();
  const toolCount = 250;
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    type: "function",
    function: { name: `tool_${String(i).padStart(3, "0")}`, description: `T${i}`, parameters: {} },
  }));

  const body = {
    model: "qwen-coder-plus",
    messages: [{ role: "user", content: "test" }],
    tools,
  };

  const result = executor.transformRequest(
    "qwen-coder-plus",
    body,
    true,
    { apiKey: "test-key" }
  );

  assert.equal(
    result.tools.length,
    toolCount,
    "Executor must not truncate — centralized truncateToolList() handles limits"
  );
});
