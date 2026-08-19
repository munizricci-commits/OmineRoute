/**
 * org/autoWiring.ts — the LIVE seam that connects the P7 routing-scope
 * primitives (`lib/org/autoScope`) to the chat-completions request path.
 *
 * Before this module the P7 primitives were unreachable from production: the
 * chat route resolved an org context only to test it for `denied`, threw it
 * away, and handed `handleChat` the RAW org-qualified model
 * (`team1/auto:coding`). The auto engine only recognizes `auto` and `auto/...`,
 * so an org-qualified auto route was never auto-routed and never scoped.
 *
 * This module is PURE apart from the injected org resolver. It performs exactly
 * two jobs:
 *   1. normalize the bare route into the form the auto engine recognizes
 *      (`auto:<suffix>` → `auto/<suffix>`), and
 *   2. return `{ body, scope }` — the (copied) body with its `model` rewritten
 *      to that bare route, plus the `RoutingScope` the caller threads into
 *      `handleChat` → `createVirtualAutoCombo` → candidate discovery.
 *
 * FAIL-CLOSED: a `denied` scope leaves the body untouched (the caller already
 * maps denied to a 404) and yields an EMPTY allowed-connection set downstream —
 * never a personal fallback. Personal scope is a strict no-op so legacy
 * `auto` / `auto/...` routing stays byte-identical.
 *
 * @module lib/org/autoWiring
 */

import { z } from "zod";
import {
  isAutoRoute,
  resolveAutoRoutingScope,
  type ResolveAutoRoutingScopeOptions,
  type RoutingScope,
} from "./autoScope";
import type { ModelBody } from "./qualifiedRoute";
import type { UserPrincipal } from "./principal";

/** Only the `model` field is read/rewritten; everything else passes through. */
const modelBodySchema = z.object({ model: z.string().min(1) });

/**
 * Map a bare org route onto the identifier the auto engine recognizes.
 *
 * Organizations qualify auto channels with a colon (`team1/auto:coding`), while
 * the engine's catalog/prefix parser uses a slash (`auto/coding`). Only the
 * exact `auto:` prefix is rewritten, so unrelated names (`autopilot:x`) and the
 * already-canonical forms (`auto`, `auto/best-coding`) are identity.
 */
export function normalizeAutoRouteForEngine(route: string): string {
  if (typeof route !== "string") return route;
  if (route.startsWith("auto:")) return `auto/${route.slice(5)}`;
  return route;
}

/** Result of the wiring step: the body to route with + the scope to thread. */
export interface AppliedOrgAutoScope<T> {
  body: T;
  scope: RoutingScope;
}

/**
 * Resolve the routing scope for a request body and apply it to the body.
 *
 * Returns a SHALLOW COPY of the body (never mutates the caller's object). The
 * `model` is rewritten only for an authorized ORGANIZATION scope whose bare
 * route targets the auto engine — org combo routes keep their existing
 * resolution path, and personal/denied bodies are returned unchanged.
 */
export async function resolveAndApplyOrgAutoScope<T extends ModelBody>(
  body: T | null | undefined,
  principal: UserPrincipal | null | undefined,
  opts?: ResolveAutoRoutingScopeOptions
): Promise<AppliedOrgAutoScope<T>> {
  const scope = await resolveAutoRoutingScope(body, principal, opts);
  const source = (body ?? ({} as T)) as T;
  const copy = { ...source } as T;

  if (scope.scope !== "organization") return { body: copy, scope };

  const parsed = modelBodySchema.safeParse({ model: scope.route });
  if (!parsed.success || !isAutoRoute(parsed.data.model)) return { body: copy, scope };

  (copy as ModelBody).model = normalizeAutoRouteForEngine(parsed.data.model);
  return { body: copy, scope };
}
