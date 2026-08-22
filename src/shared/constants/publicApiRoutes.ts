const PUBLIC_API_ROUTE_PREFIXES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc/",
  "/api/init",
  "/api/v1/",
  "/api/sync/bundle",
  "/api/oauth/",
  // Public, ticket-gated Codex device-flow completion (validate + persist).
  // The handler enforces its own single-use ticket check; no dashboard auth.
  "/api/codex/connect/",
  // Remote-mode bootstrap: exchange the management password for a scoped CLI
  // access token. The handler enforces its own password check + lockout — there
  // is no token yet at this point, so it cannot require management auth.
  "/api/cli/connect",
  // Terminal-friendly @@om-usage equivalent for CLI clients (Claude Code/Codex).
  // The handler enforces its own auth via extractUsageCommandApiKey/isValidApiKey
  // and the allowUsageCommand flag — it must not be gated by management auth.
  "/api/usage/om-usage",
  // Chaos Mode external dispatch endpoint (POST /api/skills/collect/chaos).
  // This entry only bypasses the dashboard requireLogin (cookie) gate — the
  // handler enforces its own Bearer-token auth (validateApiKey +
  // chaosModeEnabled check) before doing any work. See src/app/api/skills/
  // collect/chaos/route.ts. Do not widen this prefix to cover other
  // /api/skills/collect/* routes without the same per-handler auth.
  "/api/skills/collect/chaos",
  // Telegram Bot API update webhook + Mini App proxy. Telegram POSTs updates
  // here without any dashboard cookie/API key; the handler enforces its own
  // auth (503 when TELEGRAM_BOT_TOKEN is unset; 401 on invalid initData
  // HMAC). See src/app/api/telegram/update/route.ts. Do not widen.
  "/api/telegram/",
  // Cursor CLI passthrough (CURSOR_API_ENDPOINT -> OmniRoute -> api2.cursor.sh).
  // The handler enforces its own auth: /auth/exchange_user_api_key requires an
  // OmniRoute API key (validateApiKey); every other path requires the
  // OmniRoute-minted session JWT that exchange returns. See
  // open-sse/handlers/cursorCliProxy.ts. Do not widen.
  "/api/cursor-cli/",
];

const PUBLIC_READONLY_API_ROUTE_PREFIXES = [
  "/api/health/ping",
  "/api/monitoring/health",
  "/api/settings/require-login",
];

// Read-only routes public by EXACT path, never by prefix.
//
// `/api/health` has to be reachable without a key — a probe has none, and a 401 there is
// indistinguishable from a wrong key or a missing route. It cannot go in the prefix list
// above: `startsWith("/api/health")` would also expose `/api/health/degradation`, which is
// authenticated today.
const PUBLIC_READONLY_API_ROUTES_EXACT = new Set(["/api/health"]);

const PUBLIC_READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PUBLIC_CLOUD_API_ROUTES = [
  { path: "/api/cloud/auth", methods: new Set(["POST", "OPTIONS"]) },
  { path: "/api/cloud/model/resolve", methods: new Set(["POST", "OPTIONS"]) },
  { path: "/api/cloud/models/alias", methods: new Set(["GET", "HEAD", "OPTIONS"]) },
];

// Public, handler-self-gated mutation routes matched by EXACT path + method.
// /api/auth/register is the public self-service signup: the handler enforces the
// instance registration policy (disabled -> 403, invite-only -> requires code)
// and never returns secrets, so it must not be gated by management auth. Exact
// path (not prefix) so it cannot widen to other /api/auth/* routes.
const PUBLIC_API_ROUTES_EXACT_WITH_METHODS = [
  { path: "/api/auth/register", methods: new Set(["POST", "OPTIONS"]) },
];

function pathMatchesExactRoute(pathname: string, routePath: string): boolean {
  return pathname === routePath || pathname === `${routePath}/`;
}

function isPublicExactMethodRoute(pathname: string, method: string): boolean {
  const normalizedMethod = String(method).toUpperCase();
  return PUBLIC_API_ROUTES_EXACT_WITH_METHODS.some(
    ({ path, methods }) => pathMatchesExactRoute(pathname, path) && methods.has(normalizedMethod)
  );
}

function isPublicCloudApiRoute(pathname: string, method: string): boolean {
  const normalizedMethod = String(method).toUpperCase();
  return PUBLIC_CLOUD_API_ROUTES.some(
    ({ path, methods }) => pathMatchesExactRoute(pathname, path) && methods.has(normalizedMethod)
  );
}

export function isPublicApiRoute(pathname: string, method = "GET"): boolean {
  if (isPublicExactMethodRoute(pathname, method)) {
    return true;
  }

  if (isPublicCloudApiRoute(pathname, method)) {
    return true;
  }

  if (PUBLIC_API_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))) {
    return true;
  }

  if (!PUBLIC_READONLY_METHODS.has(String(method).toUpperCase())) {
    return false;
  }

  for (const route of PUBLIC_READONLY_API_ROUTES_EXACT) {
    if (pathMatchesExactRoute(pathname, route)) {
      return true;
    }
  }

  return PUBLIC_READONLY_API_ROUTE_PREFIXES.some((route) => pathname.startsWith(route));
}

export {
  PUBLIC_API_ROUTE_PREFIXES,
  PUBLIC_READONLY_API_ROUTE_PREFIXES,
  PUBLIC_READONLY_API_ROUTES_EXACT,
  PUBLIC_READONLY_METHODS,
  PUBLIC_API_ROUTES_EXACT_WITH_METHODS,
};
