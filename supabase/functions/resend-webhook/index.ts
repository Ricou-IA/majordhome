// ============================================================================
// Resend Webhook Handler — Mayer Mailing
// ============================================================================
//
// Reçoit les events webhook Resend et applique les updates via une RPC
// atomique (public.resend_apply_webhook_event).
//
// Architecture :
//   1. Vérif signature Svix (HMAC SHA256) — anti-forgerie + anti-replay
//   2. Parse JSON + extraction du provider_id (data.email_id)
//   3. Call RPC atomique → fait tout en 1 aller-retour DB :
//      - Insert dans mailing_events (idempotent via svix_id UNIQUE)
//      - Update mailing_logs (status + timestamps + counters)
//      - Gestion priorité statut (sent < delivered < opened < clicked < terminal)
//
// Sécurité :
//   - verify_jwt: false (Resend ne passe pas de JWT, on valide par signature)
//   - Tolérance timestamp : 5 minutes (anti-replay)
//   - Réponse 401 si signature invalide
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

// ---------------------------------------------------------------------------
// Signature Svix (HMAC SHA256 via Web Crypto API)
// ---------------------------------------------------------------------------

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function hmacSha256Base64(key: Uint8Array, message: string): Promise<string> {
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
  return base64Encode(new Uint8Array(sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!secret) return { ok: false, error: "missing_secret" };
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, error: "missing_headers" };
  }

  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, error: "invalid_timestamp" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, error: "timestamp_out_of_window" };
  }

  const secretPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64Decode(secretPart);
  } catch {
    return { ok: false, error: "invalid_secret_format" };
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${body}`;
  const expectedSig = await hmacSha256Base64(keyBytes, signedPayload);

  const headerSigs = svixSignature.split(" ");
  for (const entry of headerSigs) {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) continue;
    if (safeEqual(sig, expectedSig)) return { ok: true };
  }
  return { ok: false, error: "signature_mismatch" };
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    created_at?: string;
    email_id?: string;
    open?: { timestamp?: string };
    click?: { timestamp?: string };
    bounce?: { timestamp?: string };
    [key: string]: unknown;
  };
};

// Resend payload : data.created_at = date d'envoi du mail (constant),
// data.open.timestamp / data.click.timestamp / data.bounce.timestamp = date réelle de l'event.
// On privilégie le timestamp spécifique à l'event quand il existe.
function pickEventTimestamp(evt: ResendEvent): string {
  const d = evt.data;
  if (!d) return evt.created_at || new Date().toISOString();

  const eventType = evt.type || "";
  if (eventType === "email.opened" && d.open?.timestamp) return d.open.timestamp;
  if (eventType === "email.clicked" && d.click?.timestamp) return d.click.timestamp;
  if (eventType === "email.bounced" && d.bounce?.timestamp) return d.bounce.timestamp;

  // Fallback pour sent / delivered / complained / failed / delayed : created_at
  return d.created_at || evt.created_at || new Date().toISOString();
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleWebhook(req: Request): Promise<Response> {
  // 1. Read raw body (critical for signature verification)
  const rawBody = await req.text();

  // 2. Extract Svix headers
  const svixId = req.headers.get("svix-id") || "";
  const svixTimestamp = req.headers.get("svix-timestamp") || "";
  const svixSignature = req.headers.get("svix-signature") || "";

  // 3. Verify signature
  const verif = await verifySvixSignature(
    rawBody,
    svixId,
    svixTimestamp,
    svixSignature,
    RESEND_WEBHOOK_SECRET,
  );
  if (!verif.ok) {
    console.warn("[resend-webhook] Signature verification failed:", verif.error);
    return jsonResponse({ error: "invalid_signature", reason: verif.error }, 401);
  }

  // 4. Parse event
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const eventType = event.type || "";
  const providerId = event.data?.email_id || "";
  if (!providerId) {
    console.warn("[resend-webhook] Missing data.email_id, ignoring:", eventType);
    return jsonResponse({ ok: true, ignored: "missing_email_id" });
  }

  // 5. Apply via RPC (atomic, handles everything)
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("resend_apply_webhook_event", {
    p_provider_id: providerId,
    p_event_type: eventType,
    p_event_at: pickEventTimestamp(event),
    p_svix_id: svixId,
    p_payload: event.data || {},
  });

  if (error) {
    console.error(
      "[resend-webhook] RPC failed:",
      JSON.stringify({ code: error.code, message: error.message, details: error.details }),
    );
    return jsonResponse({ error: "db_error", details: error.message }, 500);
  }

  console.log(
    "[resend-webhook] OK",
    JSON.stringify({ eventType, providerId, result: data }),
  );
  return jsonResponse({ ok: true, result: data });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "HEAD" || req.method === "GET") {
    return jsonResponse({ service: "resend-webhook", ok: true });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  try {
    return await handleWebhook(req);
  } catch (err) {
    console.error("[resend-webhook] Unhandled error:", err);
    return jsonResponse(
      { error: "internal_error", message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
