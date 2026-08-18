/**
 * org/qualifiedRoute.ts — Qualified route parsing + resolution for the
 * Organizations "Qualified Routes" feature (P6).
 *
 * A qualified route is `<organization>/<route>` where `<route>` ∈
 * {combo name, `auto:<strategy>`, provider model id}. Legacy models with no
 * `/` stay PERSONAL (Invariant #11). REUSES the existing `auto`/`combo`
 * machinery — this module only *parses* and *scopes*; it never forks the
 * routing engine (Invariant #3).
 *
 * Parsing is PURE and synchronous (`parseQualifiedModel`). Resolution
 * (`resolveQualifiedRoute` / `buildOrgRoutingContext`) is async and
 * FAIL-CLOSED: an unknown org slug or a non-member yields `null` / `denied`
 * with no existence reveal.
 *
 * Distinguishing an org slug from a provider/model id:
 *   A provider-prefixed model id has the shape `<provider>/<model>` where the
 *   leading segment is a recognized provider NAMESPACE (e.g. `openai/gpt-4`,
 *   `anthropic/claude-3`). An org-qualified route has the shape
 *   `<orgSlug>/<route>` where the leading segment matches the org-slug shape
 *   `[a-z0-9][a-z0-9-]{1,30}` and is NOT a recognized provider namespace. This
 *   keeps legacy provider-model ids (including `openai/gpt-4`) strictly
 *   personal, while `team1/combo:dev` resolves to org `team1`.
 *
 * @module lib/org/qualifiedRoute
 */

import { getOrganizationBySlug } from "@/lib/db/organizations";
import { getOrganizationConnections } from "@/lib/db/orgConnections";
import { resolveOrganizationContext } from "./authorization";
import type { OrganizationContext } from "./types";
import type { UserPrincipal } from "./principal";

/**
 * Recognized provider namespaces. A leading segment that matches one of these
 * is treated as a provider-prefixed model id (PERSONAL), never as an org slug.
 * This is the inverse of the org-slug shape and is the only guard that keeps
 * `openai/gpt-4` personal. Org slugs must avoid these reserved names.
 */
const KNOWN_PROVIDER_NAMESPACES = new Set<string>([
  "openai",
  "anthropic",
  "google",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "meta",
  "deepseek",
  "moonshotai",
  "moonshot",
  "nvidia",
  "cohere",
  "perplexity",
  "qwen",
  "alibaba",
  "openrouter",
  "azure",
  "bedrock",
  "togetherai",
  "together",
  "fireworks",
  "replicate",
  "ollama",
  "localai",
  "vllm",
  "lmstudio",
  "ai21",
  "databricks",
  "minimax",
  "zhipuai",
  "stepfun",
  "yi",
  "baichuan",
  "kimi",
  "zai",
  "xiaomi",
  "vertex",
  "cloudflare",
  "scaleway",
  "ovh",
  "upstage",
  "venice",
  "novita",
  "tencent",
  "hunyuan",
  "claude",
  "gpt",
  "llama",
  "openai-like",
  "custom",
  "inference",
  "ai21labs",
  "aleph-alpha",
  "anyscale",
  "deepinfra",
  "watsonx",
  "ibm",
  "cloudflare-ai",
  "azure-openai",
  "aws",
  "amazon",
  "amazon-bedrock",
]);

/** Org-slug shape: single lowercase segment, 2–31 chars of [a-z0-9-]. */
const ORG_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Parsed qualified model: an optional org slug qualifier + the bare route. */
export interface ParsedQualifiedModel {
  /** Present only when the model is org-qualified (`<orgSlug>/<route>`). */
  organizationSlug?: string;
  /** The route to resolve within the (possibly personal) scope. */
  route: string;
}

/**
 * Pure, synchronous parser: split a model string into an optional
 * organization slug qualifier + the bare route.
 *
 * Rules (all personal unless an org qualifier is confidently detected):
 *  - no `/`            → personal (`{ route: model }`)
 *  - `//x` (empty leading segment) → normalized to personal (`{ route }`)
 *  - two `/` (e.g. `team1/openai/gpt-4`) → treated as a personal provider id
 *  - leading segment is a known provider namespace → personal provider model id
 *  - leading segment matches the org-slug shape (and is not a provider) →
 *    `{ organizationSlug, route }`
 *  - otherwise (malformed / unrecognized) → personal (`{ route: model }`)
 */
export function parseQualifiedModel(model: string): ParsedQualifiedModel {
  if (typeof model !== "string" || model.length === 0) {
    return { route: model ?? "" };
  }

  const firstSlash = model.indexOf("/");
  if (firstSlash === -1) {
    return { route: model };
  }

  // A second slash means this is a nested provider/model id, not org-qualified.
  if (model.indexOf("/", firstSlash + 1) !== -1) {
    return { route: model };
  }

  const leading = model.slice(0, firstSlash);
  const route = model.slice(firstSlash + 1);

  // Malformed qualifier (//x or trailing slash) → normalized to personal.
  if (leading.length === 0 || route.length === 0) {
    return { route: model };
  }

  // Leading segment is a recognized provider namespace → personal.
  if (KNOWN_PROVIDER_NAMESPACES.has(leading)) {
    return { route: model };
  }

  // Leading segment must look like an org slug to be treated as a qualifier.
  if (!ORG_SLUG_RE.test(leading)) {
    return { route: model };
  }

  return { organizationSlug: leading, route };
}

/** Resolved qualified route — org-scoped member result carries `organizationId`. */
export type ResolvedQualifiedRoute =
  | { route: string } // personal (no org qualifier)
  | { organizationId: string; route: string; organizationSlug: string } // org member
  | null; // fail-closed: org qualifier present but unknown slug / non-member

/**
 * Resolve a parsed qualified model into a concrete route scope.
 *
 * Fail-closed — returns `null` when:
 *  - `parsed.organizationSlug` is present but the slug does not resolve to an
 *    active organization, OR
 *  - the principal is not an active member of that organization.
 *
 * For a personal model (no `organizationSlug`) returns `{ route }` unchanged.
 * Reuses `resolveOrganizationContext` (the existing org authorization layer)
 * so the same fail-closed membership/active-org checks apply.
 */
export async function resolveQualifiedRoute(
  parsed: ParsedQualifiedModel,
  principal: UserPrincipal | null | undefined,
  _opts?: {/* reserved for future scope options */}
): Promise<ResolvedQualifiedRoute> {
  if (!parsed.organizationSlug) {
    return { route: parsed.route };
  }

  const org = await getOrganizationBySlug(parsed.organizationSlug);
  if (!org) return null;

  const ctx = await resolveOrganizationContext(principal, org.id);
  if (!ctx) return null;

  return {
    organizationId: org.id,
    route: parsed.route,
    organizationSlug: parsed.organizationSlug,
  };
}

/**
 * Request-shaped body that may carry a `model` field (OpenAI-style chat body).
 */
export interface ModelBody {
  model?: unknown;
}

/**
 * Org routing context for the chat-completions path (P6.03). Builds on
 * `parseQualifiedModel` + `resolveQualifiedRoute` and additionally resolves the
 * org-scoped connection id list so the handler can restrict credential
 * candidate selection to the organization's own connections.
 *
 *  - `denied: true`  → an org qualifier was present but is NOT resolvable to an
 *    active membership (fail-closed). The handler must treat the route as a
 *    not-found model and must NOT reveal the org/combo's existence.
 *  - `organizationId != null` → the principal is an active member; `route` is
 *    the bare route to resolve through the existing combo/auto/provider
 *    machinery, and `connectionIds` are the org's connections to scope onto.
 *  - `organizationId == null && !denied` → a personal (legacy) model; the
 *    handler behaves exactly as today.
 */
export interface OrgRoutingContext {
  route: string;
  organizationId: string | null;
  organizationSlug?: string;
  denied: boolean;
  connectionIds: string[];
  ctx: OrganizationContext | null;
}

/**
 * Build the org routing context for a chat-completions request body. Pure
 * w.r.t. authorization policy (fail-closed via `resolveOrganizationContext`).
 * Connection id resolution is best-effort: any error yields an empty list so a
 * misconfigured org connection lookup cannot widen the credential scope.
 */
export async function buildOrgRoutingContext(
  body: ModelBody | null | undefined,
  principal: UserPrincipal | null | undefined
): Promise<OrgRoutingContext> {
  const model =
    body && typeof body === "object" && "model" in body ? (body as ModelBody).model : undefined;

  if (typeof model !== "string" || model.length === 0) {
    return {
      route: typeof model === "string" ? model : "",
      organizationId: null,
      denied: false,
      connectionIds: [],
      ctx: null,
    };
  }

  const parsed = parseQualifiedModel(model);
  if (!parsed.organizationSlug) {
    return {
      route: parsed.route,
      organizationId: null,
      denied: false,
      connectionIds: [],
      ctx: null,
    };
  }

  const org = await getOrganizationBySlug(parsed.organizationSlug);
  if (!org) {
    return {
      route: parsed.route,
      organizationId: null,
      denied: true,
      connectionIds: [],
      ctx: null,
    };
  }

  const ctx = await resolveOrganizationContext(principal, org.id);
  if (!ctx) {
    return {
      route: parsed.route,
      organizationId: null,
      denied: true,
      connectionIds: [],
      ctx: null,
    };
  }

  let connectionIds: string[] = [];
  try {
    const conns = await getOrganizationConnections(org.id, ctx);
    connectionIds = (conns || [])
      .map((c: { id?: unknown }) => c.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    connectionIds = [];
  }

  return {
    route: parsed.route,
    organizationId: org.id,
    organizationSlug: parsed.organizationSlug,
    denied: false,
    connectionIds,
    ctx,
  };
}
