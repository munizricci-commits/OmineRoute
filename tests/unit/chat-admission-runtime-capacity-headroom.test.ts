import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import {
  DEFAULT_HEAVY_REQUEST_COST_BYTES,
  capHeavyAdmissionCapacityForScheduling,
  createRuntimeHeavyHeadroomPolicy,
  deriveRuntimeHeavyHeadroom,
  type RuntimeHeavyHeadroomInput,
} from "../../src/shared/middleware/chatAdmissionHeadroom.ts";
import {
  PerConnectionAdmissionController,
  admitChatStructure,
} from "../../src/shared/middleware/chatBodyAdmission.ts";

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

function healthyLargeHeap(
  overrides: Partial<RuntimeHeavyHeadroomInput> = {}
): RuntimeHeavyHeadroomInput {
  return {
    heapLimitBytes: 4 * GiB,
    heapUsedBytes: 512 * MiB,
    cgroupLimitBytes: null,
    cgroupUsedBytes: null,
    baseCapacity: 1,
    legacyHeadroom: 1,
    shedRatio: 0.75,
    ...overrides,
  };
}

function heavyBody() {
  return {
    messages: Array.from({ length: 200 }, () => ({ role: "user", content: "x" })),
    tools: [],
  };
}

test("healthy larger V8 heaps derive bounded headroom above the legacy default", () => {
  const result = deriveRuntimeHeavyHeadroom(healthyLargeHeap());

  assert.equal(DEFAULT_HEAVY_REQUEST_COST_BYTES, 256 * MiB);
  assert.equal(result.memorySafeHeadroom, 8);
  assert.equal(result.reason, "runtime_capacity");
});

test("small heaps and restrictive lower cgroup limits stay conservative", () => {
  const smallHeap = deriveRuntimeHeavyHeadroom(
    healthyLargeHeap({ heapLimitBytes: 512 * MiB, heapUsedBytes: 128 * MiB })
  );
  const restrictedContainer = deriveRuntimeHeavyHeadroom(
    healthyLargeHeap({
      cgroupLimitBytes: 512 * MiB,
      cgroupUsedBytes: 128 * MiB,
    })
  );

  assert.ok(smallHeap.memorySafeHeadroom <= 1);
  assert.ok(restrictedContainer.memorySafeHeadroom <= 1);
  assert.equal(restrictedContainer.reason, "runtime_cgroup_capacity");
});

test("high current heap pressure removes adaptive headroom", () => {
  const result = deriveRuntimeHeavyHeadroom(healthyLargeHeap({ heapUsedBytes: 3 * GiB }));

  assert.equal(result.memorySafeHeadroom, 0);
  assert.equal(result.reason, "heap_pressure");
});

test("high current cgroup pressure removes adaptive headroom", () => {
  const result = deriveRuntimeHeavyHeadroom(
    healthyLargeHeap({
      cgroupLimitBytes: 2 * GiB,
      cgroupUsedBytes: 1536 * MiB,
    })
  );

  assert.equal(result.memorySafeHeadroom, 0);
  assert.equal(result.reason, "cgroup_pressure");
});

test("missing, malformed, and contradictory telemetry fail closed to legacy headroom", () => {
  const missing = deriveRuntimeHeavyHeadroom(healthyLargeHeap({ heapLimitBytes: null }));
  const malformed = deriveRuntimeHeavyHeadroom(healthyLargeHeap({ heapUsedBytes: Number.NaN }));
  const contradictory = deriveRuntimeHeavyHeadroom(
    healthyLargeHeap({ heapLimitBytes: 512 * MiB, heapUsedBytes: GiB })
  );

  assert.deepEqual(
    [missing.memorySafeHeadroom, malformed.memorySafeHeadroom, contradictory.memorySafeHeadroom],
    [1, 1, 1]
  );
  assert.deepEqual(
    [missing.reason, malformed.reason, contradictory.reason],
    ["telemetry_unavailable", "telemetry_invalid", "telemetry_contradictory"]
  );
});

test("a valid explicit environment override retains exact precedence", () => {
  let samples = 0;
  const policy = createRuntimeHeavyHeadroomPolicy({
    explicitHeadroom: 5,
    baseCapacity: 1,
    legacyHeadroom: 1,
    shedRatio: 0.75,
    sample: () => {
      samples += 1;
      return healthyLargeHeap({ heapUsedBytes: 3 * GiB });
    },
  });

  assert.equal(policy.getEffectiveHeadroom(), 5);
  assert.equal(policy.getEffectiveHeadroom(), 5);
  assert.equal(samples, 0, "an explicit override must not be replaced by runtime derivation");
  assert.deepEqual(policy.snapshot(), {
    configuredHeadroom: 5,
    effectiveHeadroom: 5,
    memorySafeHeadroom: 5,
    reason: "environment_override",
  });
});

test("the production singleton preserves the explicit environment override", () => {
  const script = `
    const { perConnectionAdmissionController } = await import(
      "./src/shared/middleware/chatBodyAdmission.ts"
    );
    console.log("HEADROOM=" + JSON.stringify(perConnectionAdmissionController.snapshot()));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        APP_LOG_TO_FILE: "false",
        DATA_DIR: "/tmp/omniroute-admission-env-override",
        OMNIROUTE_CHAT_ADMISSION_HEALTHY_HEADROOM: "5",
      },
    }
  );
  const match = output.match(/^HEADROOM=(.+)$/m);
  assert.ok(match, "child process must report the production admission snapshot");
  const snapshot = JSON.parse(match[1]) as {
    configuredHealthyHeadroom: number | null;
    effectiveHealthyHeadroom: number;
    healthyHeadroomReason: string;
  };

  assert.equal(snapshot.configuredHealthyHeadroom, 5);
  assert.equal(snapshot.effectiveHealthyHeadroom, 5);
  assert.equal(snapshot.healthyHeadroomReason, "environment_override");
});

test("account count is not an input and cannot multiply the process-global memory budget", () => {
  const oneAccount = {
    ...healthyLargeHeap(),
    accountCount: 1,
  } satisfies RuntimeHeavyHeadroomInput & { accountCount: number };
  const manyAccounts = {
    ...healthyLargeHeap(),
    accountCount: 10_000,
  } satisfies RuntimeHeavyHeadroomInput & { accountCount: number };

  assert.equal(
    deriveRuntimeHeavyHeadroom(oneAccount).memorySafeHeadroom,
    deriveRuntimeHeavyHeadroom(manyAccounts).memorySafeHeadroom
  );
});

test("eligible connections only cap useful scheduling after memory-safe capacity is derived", () => {
  const memory = deriveRuntimeHeavyHeadroom(healthyLargeHeap());
  const memorySafeCapacity = memory.memorySafeHeadroom + 1;

  assert.equal(
    capHeavyAdmissionCapacityForScheduling(memorySafeCapacity, 2),
    Math.min(memorySafeCapacity, 2)
  );
  assert.equal(
    capHeavyAdmissionCapacityForScheduling(memorySafeCapacity, 10_000),
    memorySafeCapacity,
    "more eligible connections must never raise the memory-safe global capacity"
  );
});

test("growth hysteresis prevents a single healthy sample from oscillating capacity", () => {
  let telemetry = healthyLargeHeap();
  const policy = createRuntimeHeavyHeadroomPolicy({
    explicitHeadroom: null,
    baseCapacity: 1,
    legacyHeadroom: 1,
    shedRatio: 0.75,
    recoverySamples: 3,
    sample: () => telemetry,
  });

  assert.equal(policy.getEffectiveHeadroom(), 1);
  assert.equal(policy.getEffectiveHeadroom(), 1);
  assert.ok(policy.getEffectiveHeadroom() > 1, "three stable samples permit bounded growth");

  telemetry = healthyLargeHeap({ heapUsedBytes: 3 * GiB });
  assert.equal(policy.getEffectiveHeadroom(), 0, "pressure reduces capacity immediately");

  telemetry = healthyLargeHeap();
  assert.equal(policy.getEffectiveHeadroom(), 0);
  assert.equal(policy.getEffectiveHeadroom(), 0);
  assert.ok(policy.getEffectiveHeadroom() > 0, "recovery also requires stable samples");
});

test("the existing process-global controller consumes derived headroom and reports safe diagnostics", async () => {
  const policy = createRuntimeHeavyHeadroomPolicy({
    explicitHeadroom: null,
    baseCapacity: 1,
    legacyHeadroom: 1,
    shedRatio: 0.75,
    recoverySamples: 1,
    sample: () => healthyLargeHeap(),
  });
  const processGlobal = new PerConnectionAdmissionController(1, {
    healthyHeadroomPolicy: policy,
    onShed: () => {},
  });
  const controller = processGlobal.getController("key_runtime_capacity");

  const primary = await admitChatStructure(heavyBody(), null, {
    controller,
    heapPressureCheck: () => false,
  });
  const adaptive = await admitChatStructure(heavyBody(), null, {
    controller,
    heapPressureCheck: () => false,
  });
  assert.equal(primary.admit, true);
  assert.equal(adaptive.admit, true);

  const snapshot = processGlobal.snapshot();
  assert.equal(snapshot.configuredHealthyHeadroom, null);
  assert.ok(snapshot.effectiveHealthyHeadroom > 1);
  assert.equal(snapshot.healthyHeadroomReason, "runtime_capacity");
  assert.equal("heapLimitBytes" in snapshot, false);
  assert.equal("cgroupLimitBytes" in snapshot, false);

  if (primary.admit) primary.lease?.release();
  if (adaptive.admit) adaptive.lease?.release();
});

test("genuine pressure and exhausted adaptive capacity remain retryable 503s", async () => {
  let telemetry = healthyLargeHeap();
  const policy = createRuntimeHeavyHeadroomPolicy({
    explicitHeadroom: null,
    baseCapacity: 1,
    legacyHeadroom: 1,
    shedRatio: 0.75,
    recoverySamples: 1,
    sample: () => telemetry,
  });
  const processGlobal = new PerConnectionAdmissionController(1, {
    healthyHeadroomPolicy: policy,
    onShed: () => {},
  });
  const controller = processGlobal.getController("key_bounded_capacity");
  const leases = [];

  for (let index = 0; index < 9; index += 1) {
    const admission = await admitChatStructure(heavyBody(), null, {
      controller,
      heapPressureCheck: () => false,
    });
    assert.equal(admission.admit, true);
    if (admission.admit && admission.lease) leases.push(admission.lease);
  }

  const exhausted = await admitChatStructure(heavyBody(), null, {
    controller,
    heapPressureCheck: () => false,
  });
  assert.equal(exhausted.admit, false);
  if (!exhausted.admit) {
    assert.equal(exhausted.response.status, 503);
    assert.equal(exhausted.response.headers.get("Retry-After"), "1");
  }

  for (const lease of leases) lease.release();
  telemetry = healthyLargeHeap({ heapUsedBytes: 3 * GiB });

  const primary = await admitChatStructure(heavyBody(), null, {
    controller,
    heapPressureCheck: () => true,
  });
  assert.equal(primary.admit, true);
  const pressured = await admitChatStructure(heavyBody(), null, {
    controller,
    heapPressureCheck: () => true,
  });
  assert.equal(pressured.admit, false);
  if (!pressured.admit) {
    assert.equal(pressured.response.status, 503);
    assert.equal(pressured.response.headers.get("Retry-After"), "1");
  }
  if (primary.admit) primary.lease?.release();
});
