import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkKimiWebConnectionIfNeeded } from "../../src/lib/tokenHealthCheckKimi.ts";

describe("Kimi Background Health Sweep", () => {
  it("skips non-kimi-web connections", async () => {
    const handled = await checkKimiWebConnectionIfNeeded({
      conn: { provider: "openai" },
      now: new Date().toISOString(),
      log: () => {},
      logWarn: () => {},
      logError: () => {},
      getConnectionLogLabel: () => "openai-1",
      logPrefix: "[Test]",
    });
    assert.equal(handled, false);
  });

  it("triggers refresh when Kimi token is within jittered expiration window", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Token expiring in 90 seconds (within 60-240s window)
    const token =
      "eyJhbGciOiJIUzUxMiJ9." +
      Buffer.from(JSON.stringify({ exp: nowSec + 90, iat: nowSec })).toString("base64url") +
      ".sig";

    let calledRefresh = false;
    const handled = await checkKimiWebConnectionIfNeeded({
      conn: {
        id: "kimi-conn-1",
        provider: "kimi-web",
        apiKey: token,
        refreshToken: "refresh_123",
      },
      now: new Date().toISOString(),
      log: () => {},
      logWarn: () => {},
      logError: () => {},
      getConnectionLogLabel: () => "kimi-web-1",
      logPrefix: "[Test]",
      exchangeFn: async () => {
        calledRefresh = true;
        return {
          success: true,
          accessToken: "new_token",
          refreshToken: "new_refresh",
          expiresAtSec: nowSec + 900,
        };
      },
      persistFn: async () => {},
    });

    assert.equal(handled, true);
    assert.equal(calledRefresh, true);
  });
});
