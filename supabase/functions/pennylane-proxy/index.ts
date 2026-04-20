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
//   Body: { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: "/quotes", body?: {...} }
//
// Sécurité :
//   - verify_jwt: true (JWT Supabase requis)
//   - Retry automatique sur 429 (rate limit Pennylane : 25 req / 5s)
//   - Logging des appels pour debug
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL =
  Deno.env.get("PENNYLANE_BASE_URL") ||
  "https://app.pennylane.com/api/external/v2";

const MAX_RETRIES = 3;
const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-app-name, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Appel Pennylane avec retry sur 429
// ---------------------------------------------------------------------------

async function callPennylane(
  method: string,
  path: string,
  body?: Record<string, unknown>
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
        `[pennylane-proxy] 429 rate limited, retry in ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`
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
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed — use POST" }, 405);
  }

  // Vérifier le JWT Supabase
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "No auth header" }, 401);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Parser le body de la requête proxy
    const { method, path, body } = await req.json();

    if (!method || !path) {
      return jsonResponse(
        { error: "Missing required fields: method, path" },
        400
      );
    }

    if (!ALLOWED_METHODS.includes(method.toUpperCase())) {
      return jsonResponse({ error: `Invalid method: ${method}` }, 400);
    }

    // Valider que le path commence par /
    if (!path.startsWith("/")) {
      return jsonResponse({ error: "Path must start with /" }, 400);
    }

    // Vérifier que le token Pennylane est configuré
    if (!PENNYLANE_API_TOKEN) {
      return jsonResponse(
        { error: "Pennylane API token not configured" },
        500
      );
    }

    console.log(
      `[pennylane-proxy] ${method} ${path} by user ${user.id}`
    );

    // Appel Pennylane
    const result = await callPennylane(method.toUpperCase(), path, body);

    return jsonResponse(
      { data: result.data, pennylane_status: result.status },
      result.status >= 200 && result.status < 300 ? 200 : result.status
    );
  } catch (err) {
    console.error("[pennylane-proxy] Error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
