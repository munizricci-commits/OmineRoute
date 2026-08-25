import { randomUUID } from "crypto";
import { resolveAntigravityModelId } from "@omniroute/open-sse/config/antigravityModelAliases.ts";
import { resolveModelAlias } from "@/shared/constants/modelSpecs";

export type AntigravityLease = {
  id: string;
  connectionId: string;
  exactModel: string;
  acquiredAtMs: number;
  expiresAtMs: number;
};

export type LeaseAcquireResult =
  | { kind: "acquired"; lease: AntigravityLease }
  | { kind: "busy"; earliestExpiryMs: number };

const leases = new Map<string, AntigravityLease>();
const DEFAULT_LEASE_RETRY_HINT_MS = 30_000;

export function canonicalizeAntigravityExactModel(model: string | null | undefined): string {
  const requested = typeof model === "string" ? model.trim().toLowerCase() : "";
  const unprefixed = requested.replace(/^(?:antigravity|agy)\//, "");
  const canonical = resolveModelAlias(unprefixed);
  // Catalog aliases remain authoritative. This is the one documented routing
  // bridge where the public catalog name differs from the callable upstream id.
  const routingModel = canonical === "gemini-3.5-flash" ? "gemini-3-flash-agent" : canonical;
  return resolveAntigravityModelId(routingModel) || routingModel;
}

function leaseKey(connectionId: string, exactModel: string): string {
  return `antigravity\u0000${connectionId}\u0000${exactModel}`;
}

export function pruneExpiredAntigravityLeases(now = Date.now()): void {
  // Held streams are released by their response lifecycle, never elapsed time.
  void now;
}

export function getAntigravityLeaseAvailability({
  connectionId,
  requestedModel,
  now = Date.now(),
}: {
  connectionId: string;
  requestedModel: string | null | undefined;
  now?: number;
}): { available: true } | { available: false; earliestExpiryMs: number } {
  pruneExpiredAntigravityLeases(now);
  const existing = leases.get(leaseKey(connectionId, canonicalizeAntigravityExactModel(requestedModel)));
  return existing ? { available: false, earliestExpiryMs: existing.expiresAtMs } : { available: true };
}

export function tryAcquireAntigravityLease({
  connectionId,
  requestedModel,
  requestId,
  deadlineMs,
  now = Date.now(),
}: {
  connectionId: string;
  requestedModel: string | null | undefined;
  requestId?: string | null;
  deadlineMs?: number | null;
  now?: number;
}): LeaseAcquireResult {
  pruneExpiredAntigravityLeases(now);
  const exactModel = canonicalizeAntigravityExactModel(requestedModel);
  const key = leaseKey(connectionId, exactModel);
  const existing = leases.get(key);
  if (existing) return { kind: "busy", earliestExpiryMs: existing.expiresAtMs };

  // Retain this parameter for selector API compatibility; the timestamp is
  // solely a bounded POOL_BUSY Retry-After hint, not a lease expiry.
  void deadlineMs;
  const expiresAtMs = now + DEFAULT_LEASE_RETRY_HINT_MS;
  const lease: AntigravityLease = {
    id: `${requestId || "request"}:${randomUUID()}`,
    connectionId,
    exactModel,
    acquiredAtMs: now,
    expiresAtMs,
  };
  leases.set(key, lease);
  return { kind: "acquired", lease };
}

/** A lease id fences late finally blocks: it cannot release a newer lease. */
export function releaseAntigravityLease(leaseId: string | null | undefined): boolean {
  if (!leaseId) return false;
  for (const [key, lease] of leases) {
    if (lease.id === leaseId) {
      leases.delete(key);
      return true;
    }
  }
  return false;
}

export function __resetAntigravityRoutingStateForTests(): void {
  leases.clear();
}
