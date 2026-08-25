import v8 from "node:v8";

const MiB = 1024 * 1024;

/**
 * Conservative transient cost of one heavyweight request graph.
 *
 * The long-context incident behind #7849 measured roughly 253 MiB RSS after the
 * quadratic session-dedup defect was removed; Discussion #9608 independently
 * describes ordinary heavyweight request amplification in the 200-300 MiB
 * range. Rounding up to 256 MiB keeps the default derivation evidence-based and
 * deliberately conservative.
 */
export const DEFAULT_HEAVY_REQUEST_COST_BYTES = 256 * MiB;

/** Runtime-derived headroom is bounded even on very large heaps. */
export const MAX_DERIVED_HEALTHY_HEADROOM = 8;

export type RuntimeHeavyHeadroomReason =
  | "environment_override"
  | "runtime_capacity"
  | "runtime_cgroup_capacity"
  | "heap_pressure"
  | "cgroup_pressure"
  | "telemetry_unavailable"
  | "telemetry_invalid"
  | "telemetry_contradictory"
  | "recovery_hysteresis";

export type RuntimeMemoryTelemetry = {
  heapLimitBytes: number | null;
  heapUsedBytes: number | null;
  /** Optional process/container limit. `null` means no lower limit was detectable. */
  cgroupLimitBytes: number | null;
  /** Whole-process usage paired with `cgroupLimitBytes` when that limit applies. */
  cgroupUsedBytes: number | null;
};

export type RuntimeHeavyHeadroomInput = RuntimeMemoryTelemetry & {
  /** Primary process-global heavyweight slots already available. */
  baseCapacity: number;
  /** Existing conservative headroom used whenever telemetry cannot be trusted. */
  legacyHeadroom: number;
  /** Existing heap-pressure shed ratio. */
  shedRatio: number;
  perRequestCostBytes?: number;
  maxDerivedHeadroom?: number;
};

export type RuntimeHeavyHeadroomDerivation = {
  memorySafeHeadroom: number;
  reason: RuntimeHeavyHeadroomReason;
};

export type RuntimeHeavyHeadroomSnapshot = RuntimeHeavyHeadroomDerivation & {
  configuredHeadroom: number | null;
  effectiveHeadroom: number;
};

export type RuntimeHeavyHeadroomPolicy = {
  getEffectiveHeadroom(): number;
  snapshot(): RuntimeHeavyHeadroomSnapshot;
};

export type RuntimeHeavyHeadroomPolicyOptions = {
  explicitHeadroom: number | null;
  baseCapacity: number;
  legacyHeadroom: number;
  shedRatio: number;
  sample?: () => RuntimeMemoryTelemetry;
  recoverySamples?: number;
  perRequestCostBytes?: number;
  maxDerivedHeadroom?: number;
};

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function conservativeFallback(
  legacyHeadroom: number,
  reason: Extract<
    RuntimeHeavyHeadroomReason,
    "telemetry_unavailable" | "telemetry_invalid" | "telemetry_contradictory"
  >
): RuntimeHeavyHeadroomDerivation {
  return { memorySafeHeadroom: legacyHeadroom, reason };
}

function validateCoreInput(input: RuntimeHeavyHeadroomInput): void {
  if (!isPositiveSafeInteger(input.baseCapacity)) {
    throw new RangeError("baseCapacity must be a positive safe integer");
  }
  if (!isNonNegativeSafeInteger(input.legacyHeadroom)) {
    throw new RangeError("legacyHeadroom must be a non-negative safe integer");
  }
  if (!Number.isFinite(input.shedRatio) || input.shedRatio <= 0 || input.shedRatio > 1) {
    throw new RangeError("shedRatio must be finite and in (0, 1]");
  }
  const perRequestCostBytes = input.perRequestCostBytes ?? DEFAULT_HEAVY_REQUEST_COST_BYTES;
  if (!isPositiveSafeInteger(perRequestCostBytes)) {
    throw new RangeError("perRequestCostBytes must be a positive safe integer");
  }
  const maxDerivedHeadroom = input.maxDerivedHeadroom ?? MAX_DERIVED_HEALTHY_HEADROOM;
  if (!isNonNegativeSafeInteger(maxDerivedHeadroom)) {
    throw new RangeError("maxDerivedHeadroom must be a non-negative safe integer");
  }
}

function classifyByteTelemetry(value: number | null, allowZero: boolean) {
  if (value === null) return "unavailable" as const;
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    return "invalid" as const;
  }
  if (!allowZero && value === 0) return "invalid" as const;
  return "valid" as const;
}

/**
 * Derive process-global healthy headroom from trusted runtime memory signals.
 *
 * Account/provider counts are intentionally absent from this input. The memory
 * budget is derived first and can only be narrowed later by scheduling supply.
 */
export function deriveRuntimeHeavyHeadroom(
  input: RuntimeHeavyHeadroomInput
): RuntimeHeavyHeadroomDerivation {
  validateCoreInput(input);

  const heapLimitState = classifyByteTelemetry(input.heapLimitBytes, false);
  const heapUsedState = classifyByteTelemetry(input.heapUsedBytes, true);
  if (heapLimitState === "unavailable" || heapUsedState === "unavailable") {
    return conservativeFallback(input.legacyHeadroom, "telemetry_unavailable");
  }
  if (heapLimitState === "invalid" || heapUsedState === "invalid") {
    return conservativeFallback(input.legacyHeadroom, "telemetry_invalid");
  }

  const heapLimitBytes = input.heapLimitBytes as number;
  const heapUsedBytes = input.heapUsedBytes as number;
  if (heapUsedBytes > heapLimitBytes) {
    return conservativeFallback(input.legacyHeadroom, "telemetry_contradictory");
  }

  const heapSafeCeiling = Math.floor(heapLimitBytes * input.shedRatio);
  if (heapUsedBytes >= heapSafeCeiling) {
    return { memorySafeHeadroom: 0, reason: "heap_pressure" };
  }

  let availableBytes = heapSafeCeiling - heapUsedBytes;
  let reason: RuntimeHeavyHeadroomReason = "runtime_capacity";
  const cgroupLimitState = classifyByteTelemetry(input.cgroupLimitBytes, false);
  if (cgroupLimitState === "invalid") {
    return conservativeFallback(input.legacyHeadroom, "telemetry_invalid");
  }

  // Only a lower process/container limit constrains the V8-derived budget.
  if (cgroupLimitState === "valid" && (input.cgroupLimitBytes as number) < heapLimitBytes) {
    const cgroupUsedState = classifyByteTelemetry(input.cgroupUsedBytes, true);
    if (cgroupUsedState === "unavailable") {
      return conservativeFallback(input.legacyHeadroom, "telemetry_unavailable");
    }
    if (cgroupUsedState === "invalid") {
      return conservativeFallback(input.legacyHeadroom, "telemetry_invalid");
    }
    const cgroupLimitBytes = input.cgroupLimitBytes as number;
    const cgroupUsedBytes = input.cgroupUsedBytes as number;
    if (cgroupUsedBytes > cgroupLimitBytes) {
      return conservativeFallback(input.legacyHeadroom, "telemetry_contradictory");
    }
    const cgroupSafeCeiling = Math.floor(cgroupLimitBytes * input.shedRatio);
    if (cgroupUsedBytes >= cgroupSafeCeiling) {
      return { memorySafeHeadroom: 0, reason: "cgroup_pressure" };
    }
    availableBytes = Math.min(availableBytes, cgroupSafeCeiling - cgroupUsedBytes);
    reason = "runtime_cgroup_capacity";
  }

  const perRequestCostBytes = input.perRequestCostBytes ?? DEFAULT_HEAVY_REQUEST_COST_BYTES;
  const maxDerivedHeadroom = input.maxDerivedHeadroom ?? MAX_DERIVED_HEALTHY_HEADROOM;
  const memorySafeTotalCapacity = Math.floor(availableBytes / perRequestCostBytes);
  const derivedHeadroom = Math.max(0, memorySafeTotalCapacity - input.baseCapacity);
  return {
    memorySafeHeadroom: Math.min(maxDerivedHeadroom, derivedHeadroom),
    reason,
  };
}

/**
 * Apply downstream scheduling supply only after the memory-safe global capacity
 * exists. More eligible connections can remove a cap, but can never raise that
 * memory-safe capacity.
 */
export function capHeavyAdmissionCapacityForScheduling(
  memorySafeCapacity: number,
  eligibleConnectionCount: number | null
): number {
  if (!isNonNegativeSafeInteger(memorySafeCapacity)) {
    throw new RangeError("memorySafeCapacity must be a non-negative safe integer");
  }
  if (eligibleConnectionCount === null) return memorySafeCapacity;
  if (!isNonNegativeSafeInteger(eligibleConnectionCount)) {
    return memorySafeCapacity;
  }
  return Math.min(memorySafeCapacity, eligibleConnectionCount);
}

/** Read privacy-sensitive memory values for internal derivation only. */
export function sampleRuntimeMemoryTelemetry(): RuntimeMemoryTelemetry {
  let heapLimitBytes: number | null = null;
  let heapUsedBytes: number | null = null;
  let cgroupLimitBytes: number | null = null;
  let cgroupUsedBytes: number | null = null;

  try {
    const heap = v8.getHeapStatistics();
    heapLimitBytes = heap.heap_size_limit;
    heapUsedBytes = heap.used_heap_size;
  } catch {
    // The derivation treats absent V8 statistics as conservative fallback.
  }

  try {
    const memory = process.memoryUsage();
    if (heapUsedBytes === null) heapUsedBytes = memory.heapUsed;
    const constrained = process.constrainedMemory();
    // libuv may expose UINT64_MAX (rounded by JavaScript) when no constraint
    // exists. Treat that documented platform sentinel like zero/unknown, not
    // like malformed applicable telemetry that would disable V8 derivation.
    if (constrained > 0 && constrained <= Number.MAX_SAFE_INTEGER) {
      cgroupLimitBytes = constrained;
      const available = process.availableMemory();
      cgroupUsedBytes =
        Number.isSafeInteger(available) && available >= 0 && available <= constrained
          ? constrained - available
          : Number.NaN;
    } else if (!Number.isFinite(constrained) || constrained < 0) {
      cgroupLimitBytes = Number.NaN;
    }
  } catch {
    // Keep any V8 sample; missing paired container telemetry fails closed when applicable.
  }

  return { heapLimitBytes, heapUsedBytes, cgroupLimitBytes, cgroupUsedBytes };
}

/**
 * Stateful default policy: decreases are immediate; increases require stable
 * repeated samples so a GC boundary cannot oscillate admission capacity.
 */
export function createRuntimeHeavyHeadroomPolicy(
  options: RuntimeHeavyHeadroomPolicyOptions
): RuntimeHeavyHeadroomPolicy {
  if (options.explicitHeadroom !== null && !isNonNegativeSafeInteger(options.explicitHeadroom)) {
    throw new RangeError("explicitHeadroom must be a non-negative safe integer or null");
  }
  const recoverySamples = options.recoverySamples ?? 3;
  if (!isPositiveSafeInteger(recoverySamples)) {
    throw new RangeError("recoverySamples must be a positive safe integer");
  }

  if (options.explicitHeadroom !== null) {
    const fixed = options.explicitHeadroom;
    const snapshot: RuntimeHeavyHeadroomSnapshot = {
      configuredHeadroom: fixed,
      effectiveHeadroom: fixed,
      memorySafeHeadroom: fixed,
      reason: "environment_override",
    };
    return {
      getEffectiveHeadroom: () => fixed,
      snapshot: () => ({ ...snapshot }),
    };
  }

  const sample = options.sample ?? sampleRuntimeMemoryTelemetry;
  let effectiveHeadroom = options.legacyHeadroom;
  let memorySafeHeadroom = options.legacyHeadroom;
  let reason: RuntimeHeavyHeadroomReason = "telemetry_unavailable";
  let pendingGrowth: number | null = null;
  let pendingGrowthSamples = 0;

  const refresh = (): number => {
    let telemetry: RuntimeMemoryTelemetry;
    try {
      telemetry = sample();
    } catch {
      telemetry = {
        heapLimitBytes: null,
        heapUsedBytes: null,
        cgroupLimitBytes: null,
        cgroupUsedBytes: null,
      };
    }
    const derived = deriveRuntimeHeavyHeadroom({
      ...telemetry,
      baseCapacity: options.baseCapacity,
      legacyHeadroom: options.legacyHeadroom,
      shedRatio: options.shedRatio,
      perRequestCostBytes: options.perRequestCostBytes,
      maxDerivedHeadroom: options.maxDerivedHeadroom,
    });
    memorySafeHeadroom = derived.memorySafeHeadroom;

    if (memorySafeHeadroom <= effectiveHeadroom) {
      effectiveHeadroom = memorySafeHeadroom;
      pendingGrowth = null;
      pendingGrowthSamples = 0;
      reason = derived.reason;
      return effectiveHeadroom;
    }

    if (pendingGrowth === memorySafeHeadroom) {
      pendingGrowthSamples += 1;
    } else {
      pendingGrowth = memorySafeHeadroom;
      pendingGrowthSamples = 1;
    }
    if (pendingGrowthSamples >= recoverySamples) {
      effectiveHeadroom = memorySafeHeadroom;
      pendingGrowth = null;
      pendingGrowthSamples = 0;
      reason = derived.reason;
    } else {
      reason = "recovery_hysteresis";
    }
    return effectiveHeadroom;
  };

  return {
    getEffectiveHeadroom: refresh,
    snapshot: () => ({
      configuredHeadroom: null,
      effectiveHeadroom,
      memorySafeHeadroom,
      reason,
    }),
  };
}
