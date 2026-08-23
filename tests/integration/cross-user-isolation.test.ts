/**
 * 09-security-hardening / Task 03 — cross-user resource isolation (TDD, integration).
 *
 * Verifies the isolation guarantees that already exist in the data layer:
 *  - API keys created by user A are ONLY returned for user A, never user B
 *  - a user cannot read/revoke another user's keys (lookup by owner)
 *  - organization membership is per-user (a member of org X is not a member of org Y)
 * This guards against horizontal privilege escalation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-sec03-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "test-storage-key-0123456789abcdef";
process.env.API_KEY_SECRET = "test-api-key-secret-0123456789abcdef";

const core = await import("../../src/lib/db/core.ts");
const { createUserSync } = await import("../../src/lib/db/users.ts");
const { createApiKey, getApiKeysByUser, setApiKeyUserId } =
  await import("../../src/lib/db/apiKeys.ts");
const { createOrganization } = await import("../../src/lib/db/organizations.ts");
const { addMember, getMembership } = await import("../../src/lib/db/members.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  for (const f of ["storage.sqlite", "storage.sqlite-wal", "storage.sqlite-shm"]) {
    try {
      fs.rmSync(path.join(TEST_DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("API keys are scoped to their owner; user B cannot see user A's keys", async () => {
  const a = createUserSync({ role: "user", email: "a@x.io" });
  const b = createUserSync({ role: "user", email: "b@x.io" });
  const key = await createApiKey("key-a", "machine-1", ["read"]);
  await setApiKeyUserId(key.id, a.id);

  const aKeys = await getApiKeysByUser(a.id);
  const bKeys = await getApiKeysByUser(b.id);
  assert.equal(aKeys.length, 1);
  assert.equal(bKeys.length, 0);
  assert.equal(aKeys[0].id, key.id);
});

test("org membership is per-user: a member of org X is not in org Y", async () => {
  const ownerX = createUserSync({ role: "user", email: "ownerx@x.io" });
  const ownerY = createUserSync({ role: "user", email: "ownery@x.io" });
  const memberX = createUserSync({ role: "user", email: "mx@x.io" });
  const memberY = createUserSync({ role: "user", email: "my@x.io" });
  const orgX = await createOrganization({ name: "X", slug: "x", ownerUserId: ownerX.id });
  const orgY = await createOrganization({ name: "Y", slug: "y", ownerUserId: ownerY.id });
  await addMember({
    organizationId: orgX.id,
    userId: memberX.id,
    role: "member",
    actorUserId: ownerX.id,
  });
  await addMember({
    organizationId: orgY.id,
    userId: memberY.id,
    role: "member",
    actorUserId: ownerY.id,
  });

  // Each member is only in their own org; never the other's.
  assert.ok(await getMembership(orgX.id, memberX.id));
  assert.equal(await getMembership(orgY.id, memberX.id), null);
  assert.ok(await getMembership(orgY.id, memberY.id));
  assert.equal(await getMembership(orgX.id, memberY.id), null);
});
