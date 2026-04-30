// ============================================================================
// gsc-oauth-init — Construit l'URL OAuth Google Search Console
// ============================================================================
//
// Le frontend appelle cette fonction (POST avec JWT) pour obtenir l'URL Google
// d'autorisation a laquelle rediriger l'utilisateur. Le client_id Google reste
// cote serveur (pas expose au navigateur).
//
// Interface :
//   POST /functions/v1/gsc-oauth-init
//   Authorization: Bearer <supabase_jwt>
//   Body: { orgId: string, returnTo: string }
//   -> Response: { url: string }
//
// Securite :
//   - verify_jwt: true (JWT Supabase requis)
//   - Valide que le user appartient a l'org demandee
//   - Valide returnTo contre la whitelist FRONTEND_ORIGINS
//   - Le state OAuth = base64({ orgId, returnTo }) pour reprise au callback
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GSC_CLIENT_ID = Deno.env.get("GSC_CLIENT_ID") || "";
const FRONTEND_ORIGINS = (Deno.env.get("FRONTEND_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAllowedOrigin(origin: string): boolean {
  return FRONTEND_ORIGINS.includes(origin);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!GSC_CLIENT_ID) {
    return jsonResponse({ error: "GSC_CLIENT_ID not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "No auth header" }, 401);

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const { orgId, returnTo } = await req.json();
    if (!orgId || !returnTo) {
      return jsonResponse({ error: "Missing orgId or returnTo" }, 400);
    }
    if (!isAllowedOrigin(returnTo)) {
      return jsonResponse({ error: "Origin not allowed" }, 400);
    }

    // Verifie que le user est bien membre de l'org
    const { data: membership, error: memErr } = await supa
      .schema("core")
      .from("organization_members")
      .select("org_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr) {
      return jsonResponse({ error: `DB error: ${memErr.message}` }, 500);
    }
    if (!membership) {
      return jsonResponse({ error: "Not a member of this org" }, 403);
    }

    const callbackUri = `${SUPABASE_URL}/functions/v1/gsc-oauth-callback`;

    // state = base64url({ orgId, returnTo })
    const stateJson = JSON.stringify({ orgId, returnTo });
    const state = btoa(stateJson);

    const params = new URLSearchParams({
      client_id: GSC_CLIENT_ID,
      redirect_uri: callbackUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return jsonResponse({ url });
  } catch (err) {
    console.error("[gsc-oauth-init] Error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal error" },
      500
    );
  }
});
