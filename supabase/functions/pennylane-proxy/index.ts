// ============================================================================
// pennylane-proxy — Edge Function proxy sécurisé vers API Pennylane V2
// ============================================================================
//
// Toutes les requêtes frontend vers Pennylane passent par ce proxy.
// Le token API Pennylane ne transite JAMAIS côté client.
//
// Interface :
//   POST /functions/v1/pennylane-proxy
//   Authorization: Bearer <supabase_jwt>
//   Body: { method: "GET"|"POST"|"PUT", path: "/quotes", body?: {...} }
//
// Sécurité (P0.3 — 2026-05-21, refactor helper P0.25 — 2026-05-21) :
//   - verify_jwt: true (JWT Supabase requis)
//   - requireOrgMembership({ orgSettingsFilter: settings.pennylane.enabled })
//     → user doit être membre d'au moins une org Pennylane-enabled (sinon 403)
//   - Allowlist paths : /customers, /customer_invoices, /quotes, /ledger_accounts
//   - Allowlist méthodes par path (GET partout, POST/PUT restreints)
//   - DELETE et PATCH bloqués partout
//   - Retry automatique sur 429 (rate limit Pennylane : 25 req / 5s)
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResponse,
  requireOrgMembership,
} from "../_shared/auth.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL =
  Deno.env.get("PENNYLANE_BASE_URL") ||
  "https://app.pennylane.com/api/external/v2";

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Allowlist paths × méthodes
// ---------------------------------------------------------------------------
// Chaque entrée : { prefix, methods }. Un path est autorisé si :
//   - son chemin (avant le `?`) commence par `prefix`
//   - la méthode est dans `methods`
// DELETE et PATCH ne sont autorisés nulle part.
// ---------------------------------------------------------------------------
const ALLOWED_ROUTES: { prefix: string; methods: string[] }[] = [
  { prefix: "/customers", methods: ["GET", "POST"] },
  { prefix: "/customer_invoices", methods: ["GET"] },
  { prefix: "/quotes", methods: ["GET", "POST", "PUT"] },
  { prefix: "/ledger_accounts", methods: ["GET"] },
];

function isRouteAllowed(method: string, path: string): boolean {
  const cleanPath = path.split("?")[0];
  for (const route of ALLOWED_ROUTES) {
    if (cleanPath === route.prefix || cleanPath.startsWith(route.prefix + "/")) {
      return route.methods.includes(method);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Appel Pennylane avec retry sur 429
// ---------------------------------------------------------------------------

async function callPennylane(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const url = `${PENNYLANE_BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${PENNYLANE_API_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    if (body && method !== "GET") {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    // Rate limit — retry after delay
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
      console.log(
        `[pennylane-proxy] 429 rate limited, retry in ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data };
  }

  return { status: 429, data: { error: "Rate limit exceeded after retries" } };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed — use POST" }, 405);
  }

  try {
    // Auth + membership user × org Pennylane-enabled via helper partagé (P0.25).
    const auth = await requireOrgMembership(req, {
      orgSettingsFilter: (s) => {
        const pl = s.pennylane as { enabled?: boolean } | undefined;
        return pl?.enabled === true;
      },
    });
    if (!auth.ok) return auth.response;
    const { userId, orgId } = auth;

    // Parser le body de la requête proxy
    const { method, path, body } = await req.json();

    if (!method || !path) {
      return jsonResponse(
        { error: "Missing required fields: method, path" },
        400,
      );
    }

    const upperMethod = String(method).toUpperCase();

    // Bloquer explicitement DELETE et PATCH
    if (upperMethod === "DELETE" || upperMethod === "PATCH") {
      console.warn(
        `[pennylane-proxy] user ${userId} (org ${orgId}) attempted ${upperMethod} ${path} — blocked`,
      );
      return jsonResponse(
        { error: `Method ${upperMethod} not allowed via proxy` },
        405,
      );
    }

    // Valider que le path commence par /
    if (typeof path !== "string" || !path.startsWith("/")) {
      return jsonResponse({ error: "Path must start with /" }, 400);
    }

    // Allowlist check
    if (!isRouteAllowed(upperMethod, path)) {
      console.warn(
        `[pennylane-proxy] user ${userId} (org ${orgId}) attempted ${upperMethod} ${path} — not in allowlist`,
      );
      return jsonResponse(
        { error: `Route not allowed: ${upperMethod} ${path}` },
        403,
      );
    }

    // Vérifier que le token Pennylane est configuré
    if (!PENNYLANE_API_TOKEN) {
      return jsonResponse(
        { error: "Pennylane API token not configured" },
        500,
      );
    }

    console.log(
      `[pennylane-proxy] ${upperMethod} ${path} by user ${userId} (org ${orgId})`,
    );

    const result = await callPennylane(upperMethod, path, body);

    return jsonResponse(
      { data: result.data, pennylane_status: result.status },
      result.status >= 200 && result.status < 300 ? 200 : result.status,
    );
  } catch (err) {
    console.error("[pennylane-proxy] Error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
