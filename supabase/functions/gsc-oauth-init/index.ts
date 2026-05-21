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
// Securite (P0.4) :
//   - verify_jwt: true (JWT Supabase requis)
//   - Valide que le user appartient a l'org demandee
//   - Valide returnTo contre la whitelist FRONTEND_ORIGINS
//   - Le state OAuth est signe HMAC-SHA256 avec RESEND_WEBHOOK_SECRET et lie
//     a (orgId, userId, returnTo, nonce, exp). Au callback : revalidation
//     signature + expiration + membership. Empeche CSRF (state forge),
//     replay (nonce + exp 10 min) et user-switch (binding userId).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireOrgMembership } from "../_shared/auth.ts";

const GSC_CLIENT_ID = Deno.env.get("GSC_CLIENT_ID") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FRONTEND_ORIGINS = (Deno.env.get("FRONTEND_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const STATE_TTL_SECONDS = 600; // 10 min — fenetre OAuth raisonnable

// ---------------------------------------------------------------------------
// State signe (HMAC-SHA256) — P0.4
// ---------------------------------------------------------------------------

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array | string): string {
  const buf =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getHmacKeyBytes(): Uint8Array {
  // RESEND_WEBHOOK_SECRET est au format Svix `whsec_<base64>` — on decode
  // la partie base64 pour obtenir la cle binaire (meme pattern que
  // mailing-unsubscribe / resend-webhook).
  const secretPart = RESEND_WEBHOOK_SECRET.startsWith("whsec_")
    ? RESEND_WEBHOOK_SECRET.slice(6)
    : RESEND_WEBHOOK_SECRET;
  return base64Decode(secretPart);
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(sig);
}

interface SignedStatePayload {
  orgId: string;
  userId: string;
  returnTo: string;
  nonce: string;
  exp: number;
}

async function signState(payload: SignedStatePayload): Promise<string> {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sigBytes = await hmacSha256(getHmacKeyBytes(), payloadB64);
  const sigB64 = base64UrlEncode(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

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
  if (!RESEND_WEBHOOK_SECRET) {
    return jsonResponse(
      { error: "RESEND_WEBHOOK_SECRET not configured (required for state signing)" },
      500,
    );
  }

  try {
    const { orgId, returnTo } = await req.json();
    if (!orgId || !returnTo) {
      return jsonResponse({ error: "Missing orgId or returnTo" }, 400);
    }
    if (!isAllowedOrigin(returnTo)) {
      return jsonResponse({ error: "Origin not allowed" }, 400);
    }

    // Auth + membership user x org via helper partage (P0.25).
    const auth = await requireOrgMembership(req, { orgId });
    if (!auth.ok) return auth.response;
    const { userId } = auth;

    const callbackUri = `${SUPABASE_URL}/functions/v1/gsc-oauth-callback`;

    // state signe HMAC-SHA256 (P0.4) — payload + signature pour anti-CSRF,
    // anti-replay (nonce + exp) et anti user-switch (userId binde).
    const nonce = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
    const state = await signState({ orgId, userId, returnTo, nonce, exp });

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
