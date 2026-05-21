// ============================================================================
// Mailing Unsubscribe Handler — Mayer Mailing
// ============================================================================
// 2 canaux :
//   GET  ?token=xxx → redirect vers mayer-energie.fr/desabonnement?unsub=ok
//   POST ?token=xxx → JSON response (appel depuis la page Next.js + RFC 8058)
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type TokenPayload = { rt: "c" | "l"; rid: string; exp: number };

async function verifyToken(token: string): Promise<{ ok: boolean; payload?: TokenPayload; error?: string }> {
  if (!token) return { ok: false, error: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, error: "invalid_format" };
  const [rt, rid, expStr, sigB64] = parts;
  if (rt !== "c" && rt !== "l") return { ok: false, error: "invalid_rt" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid))
    return { ok: false, error: "invalid_rid" };
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return { ok: false, error: "invalid_exp" };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: "token_expired" };
  const secretPart = RESEND_WEBHOOK_SECRET.startsWith("whsec_") ? RESEND_WEBHOOK_SECRET.slice(6) : RESEND_WEBHOOK_SECRET;
  const keyBytes = base64Decode(secretPart);
  const sigBytes = await hmacSha256(keyBytes, `${rt}.${rid}.${expStr}`);
  if (!safeEqual(sigB64, base64UrlEncode(sigBytes))) return { ok: false, error: "signature_mismatch" };
  return { ok: true, payload: { rt: rt as "c" | "l", rid, exp } };
}

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function applyUnsubscribe(payload: TokenPayload, reason: string) {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("mailing_apply_unsubscribe", {
    p_recipient_type: payload.rt,
    p_recipient_id: payload.rid,
    p_reason: reason,
    p_unsubscribed_at: new Date().toISOString(),
  });
  if (error) console.error("[mailing-unsubscribe] RPC failed:", error);
  return { ok: !error, already: data?.already_unsubscribed === true };
}

// P0.16 — Multi-tenant : charger l'URL de landing depuis settings org du destinataire.
// Fallback Mayer si payload absent ou org settings non configurées.
const DEFAULT_LANDING_URL = "https://www.mayer-energie.fr/desabonnement";

async function getUnsubscribeLandingUrl(payload: TokenPayload | null): Promise<string> {
  if (!payload) return DEFAULT_LANDING_URL;
  try {
    const admin = getAdminClient();
    const tableName = payload.rt === "c" ? "clients" : "leads";
    const { data: recipient } = await admin
      .schema("majordhome")
      .from(tableName)
      .select("org_id")
      .eq("id", payload.rid)
      .maybeSingle();
    if (!recipient?.org_id) return DEFAULT_LANDING_URL;
    const { data: org } = await admin
      .schema("core")
      .from("organizations")
      .select("settings")
      .eq("id", recipient.org_id)
      .maybeSingle();
    const settings = (org?.settings as Record<string, string | null> | null) || {};
    return settings.unsubscribe_landing_url || DEFAULT_LANDING_URL;
  } catch (err) {
    console.warn("[mailing-unsubscribe] getUnsubscribeLandingUrl failed:", err);
    return DEFAULT_LANDING_URL;
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Extraire le token (query param ou body form)
    let token = url.searchParams.get("token") || "";
    if (!token && req.method === "POST") {
      try {
        const body = await req.text();
        token = new URLSearchParams(body).get("token") || "";
      } catch { /* ignore */ }
    }

    const verif = await verifyToken(token);

    // GET = redirect (lien dans l'email cliqué directement)
    if (req.method === "GET") {
      const landingUrl = await getUnsubscribeLandingUrl(verif.payload || null);
      if (!verif.ok || !verif.payload) {
        return Response.redirect(landingUrl, 302);
      }
      await applyUnsubscribe(verif.payload, "user_request");
      const sep = landingUrl.includes("?") ? "&" : "?";
      return Response.redirect(`${landingUrl}${sep}unsub=ok`, 302);
    }

    // POST = JSON (appel depuis la page Next.js ou RFC 8058 one-click)
    if (req.method === "POST") {
      if (!verif.ok || !verif.payload) {
        return jsonResponse({ error: "invalid_token", reason: verif.error }, 400);
      }
      const result = await applyUnsubscribe(verif.payload, "user_request");
      return jsonResponse({ ok: true, already: result.already });
    }

    if (req.method === "HEAD") return new Response(null, { status: 200, headers: corsHeaders });
    return jsonResponse({ error: "method_not_allowed" }, 405);
  } catch (err) {
    console.error("[mailing-unsubscribe] Unhandled:", err);
    if (req.method === "GET") {
      return Response.redirect(DEFAULT_LANDING_URL, 302);
    }
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
