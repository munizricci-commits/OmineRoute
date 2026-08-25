import test from "node:test";
import assert from "node:assert/strict";

import { resolvePassword } from "../../../bin/cli/commands/setup.mjs";

/**
 * `INITIAL_PASSWORD` seeds the first dashboard password and nothing after it.
 *
 * A default `npm install -g omniroute` puts `INITIAL_PASSWORD=CHANGEME` in the
 * environment, so before #11494 every `setup` run — including ones that only
 * meant to add a provider — re-hashed `CHANGEME` over whatever the operator had
 * chosen, and printed "Admin password configured" while doing it.
 */

const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;

/** A prompt that fails the test if `setup` ever reaches it. */
const noPrompt = {
  ask: async () => assert.fail("resolvePassword must not prompt in non-interactive mode"),
  askSecret: async () => assert.fail("resolvePassword must not prompt in non-interactive mode"),
};

async function withInitialPassword<T>(value: string, fn: () => Promise<T>): Promise<T> {
  process.env.INITIAL_PASSWORD = value;
  try {
    return await fn();
  } finally {
    if (ORIGINAL_INITIAL_PASSWORD === undefined) {
      delete process.env.INITIAL_PASSWORD;
    } else {
      process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
    }
  }
}

// A stored bcrypt hash, i.e. an operator who already set their own password.
const STORED_HASH = "$2b$10$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU";

test("INITIAL_PASSWORD does not replace a password that is already set (#11494)", async () => {
  const resolved = await withInitialPassword("CHANGEME", () =>
    resolvePassword({}, noPrompt, true, STORED_HASH)
  );

  // Empty means "write nothing" — setupPassword leaves the stored hash alone.
  assert.equal(resolved, "");
});

test("INITIAL_PASSWORD still seeds the first password (#8439)", async () => {
  const resolved = await withInitialPassword("from-the-environment", () =>
    resolvePassword({}, noPrompt, true, "")
  );

  assert.equal(resolved, "from-the-environment");
});

test("an explicit --password still wins over a stored one", async () => {
  const resolved = await withInitialPassword("CHANGEME", () =>
    resolvePassword({ password: "chosen-on-the-command-line" }, noPrompt, true, STORED_HASH)
  );

  assert.equal(resolved, "chosen-on-the-command-line");
});

test("no INITIAL_PASSWORD and nothing stored still writes nothing non-interactively", async () => {
  const original = process.env.INITIAL_PASSWORD;
  delete process.env.INITIAL_PASSWORD;
  try {
    assert.equal(await resolvePassword({}, noPrompt, true, ""), "");
  } finally {
    if (original !== undefined) process.env.INITIAL_PASSWORD = original;
  }
});
