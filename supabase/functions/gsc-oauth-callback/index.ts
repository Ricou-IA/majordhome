// ============================================================================
// gsc-oauth-callback — Callback OAuth Google Search Console
// ============================================================================
//
// Recoit le code retourne par Google apres consentement utilisateur.
// Echange le code contre un refresh_token, recupere la liste des sites GSC
// accessibles, stocke tout dans core.organizations.settings, redirige le user
// vers le frontend.
//
// Interface :
//   GET /functions/v1/gsc-oauth-callback?code=...&state=...
//
// Securite (P0.4) :
//   - verify_jwt: false (callback OAuth public, pas de JWT possible)
//   - state signe HMAC-SHA256 avec RESEND_WEBHOOK_SECRET : verifie signature
//     (timing-safe) + expiration (10 min) + binding (orgId, userId, returnTo)
//   - Revalidation membership userId/orgId au moment du callback (le user a
//     pu etre revoque entre init et callback)
//   - returnTo verifie contre la whitelist FRONTEND_ORIGINS
//   - refresh_token jamais expose cote client
//   - Echange code -> token cote serveur uniquement
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GSC_CLIENT_ID = Deno.env.get("GSC_CLIENT_ID") || "";
const GSC_CLIENT_SECRET = Deno.env.get("GSC_CLIENT_SECRET") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const FRONTEND_ORIGINS = (Deno.env.get("FRONTEND_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// State signe (HMAC-SHA256) — P0.4 — mirror de gsc-oauth-init/signState
// ---------------------------------------------------------------------------

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return base64Decode(b64);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

function getHmacKeyBytes(): Uint8Array {
  const secretPart = RESEND_WEBHOOK_SECRET.startsWith("whsec_")
    ? RESEND_WEBHOOK_SECRET.slice(6)
    : RESEND_WEBHOOK_SECRET;
  return base64Decode(secretPart);
}

interface SignedStatePayload {
  orgId: string;
  userId: string;
  returnTo: string;
  nonce: string;
  exp: number;
}

async function verifySignedState(
  stateRaw: string,
): Promise<{ ok: true; payload: SignedStatePayload } | { ok: false; error: string }> {
  const parts = stateRaw.split(".");
  if (parts.length !== 2) return { ok: false, error: "invalid_format" };
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return { ok: false, error: "invalid_parts" };

  let expectedSig: string;
  try {
    const expectedBytes = await hmacSha256(getHmacKeyBytes(), payloadB64);
    expectedSig = base64UrlEncode(expectedBytes);
  } catch {
    return { ok: false, error: "hmac_compute_failed" };
  }
  if (!safeEqual(sigB64, expectedSig)) return { ok: false, error: "signature_mismatch" };

  let payload: SignedStatePayload;
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(decoded) as SignedStatePayload;
  } catch {
    return { ok: false, error: "payload_decode_failed" };
  }

  if (
    typeof payload.orgId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.returnTo !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, error: "payload_shape_invalid" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "state_expired" };
  }
  return { ok: true, payload };
}

function htmlError(msg: string, status = 400): Response {
  const safe = msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Erreur OAuth GSC</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:600px;margin:0 auto}h1{color:#b91c1c}</style>
</head><body><h1>Erreur lors de la connexion Google Search Console</h1><p>${safe}</p>
<p><a href="javascript:history.back()">Retour</a></p></body></html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function isAllowedOrigin(origin: string): boolean {
  return FRONTEND_ORIGINS.includes(origin);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return htmlError(`Google a retourne une erreur OAuth : ${oauthError}`);
  }
  if (!code || !stateRaw) {
    return htmlError("Parametres manquants (code ou state).");
  }
  if (!GSC_CLIENT_ID || !GSC_CLIENT_SECRET) {
    return htmlError("Credentials Google non configures cote serveur.", 500);
  }
  if (!RESEND_WEBHOOK_SECRET) {
    return htmlError(
      "RESEND_WEBHOOK_SECRET non configure cote serveur (requis pour verification state).",
      500,
    );
  }

  // Verifie la signature HMAC du state (P0.4) — anti-CSRF / anti-replay / binding userId.
  const stateVerif = await verifySignedState(stateRaw);
  if (!stateVerif.ok) {
    return htmlError(`State OAuth invalide : ${stateVerif.error}.`);
  }
  const state = stateVerif.payload;
  if (!isAllowedOrigin(state.returnTo)) {
    return htmlError(`Origin non autorisee : ${state.returnTo}`);
  }

  // Revalidation membership : entre l'init et le callback, le user a pu etre
  // revoque de l'org. On verifie qu'il est toujours membre avant d'ecrire le
  // refresh_token sur l'org.
  const supaCheck = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: membership, error: memErr } = await supaCheck
    .schema("core")
    .from("organization_members")
    .select("org_id")
    .eq("org_id", state.orgId)
    .eq("user_id", state.userId)
    .maybeSingle();
  if (memErr) {
    return htmlError(`Verification membership echouee : ${memErr.message}`, 500);
  }
  if (!membership) {
    return htmlError(
      "Vous n'etes plus membre de cette organisation. Connexion GSC annulee.",
      403,
    );
  }

  // Le redirect_uri envoye doit etre identique a celui utilise dans l'init
  const redirectUri = `${SUPABASE_URL}/functions/v1/gsc-oauth-callback`;

  // Echange code -> tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GSC_CLIENT_ID,
      client_secret: GSC_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    return htmlError(
      `Echec echange du code : ${tokenJson.error_description ?? tokenJson.error ?? "inconnu"}`
    );
  }
  const refreshToken = tokenJson.refresh_token as string | undefined;
  const accessToken = tokenJson.access_token as string | undefined;
  if (!refreshToken || !accessToken) {
    return htmlError(
      "Google n'a pas retourne de refresh_token. Verifiez que prompt=consent et access_type=offline sont actifs."
    );
  }

  // Liste les sites GSC accessibles avec ce token
  const sitesRes = await fetch(
    "https://www.googleapis.com/webmasters/v3/sites",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const sitesJson = await sitesRes.json();
  if (!sitesRes.ok) {
    return htmlError(
      `Echec liste des sites GSC : ${sitesJson.error?.message ?? "inconnu"}`
    );
  }
  const sites: Array<{ siteUrl: string; permissionLevel: string }> =
    sitesJson.siteEntry ?? [];

  if (sites.length === 0) {
    return htmlError(
      "Aucun site GSC accessible avec ce compte Google. Assurez-vous d'avoir ajoute ce compte comme utilisateur dans Search Console."
    );
  }

  // Choix du site : priorite a la propriete de domaine mayer-energie.fr
  let chosen = sites.find((s) => s.siteUrl === "sc-domain:mayer-energie.fr");
  if (!chosen) chosen = sites.find((s) => s.siteUrl.includes("mayer-energie"));
  if (!chosen) chosen = sites[0];

  // Stocke dans core.organizations.settings
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: orgRow, error: readErr } = await supa
    .schema("core")
    .from("organizations")
    .select("settings")
    .eq("id", state.orgId)
    .maybeSingle();

  if (readErr) return htmlError(`Lecture org echouee : ${readErr.message}`, 500);
  if (!orgRow) return htmlError("Organisation introuvable.", 404);

  const newSettings = {
    ...((orgRow.settings as Record<string, unknown>) ?? {}),
    gsc_refresh_token: refreshToken,
    gsc_site_url: chosen.siteUrl,
    gsc_permission_level: chosen.permissionLevel,
    gsc_connected_at: new Date().toISOString(),
  };

  const { error: updErr } = await supa
    .schema("core")
    .from("organizations")
    .update({ settings: newSettings })
    .eq("id", state.orgId);

  if (updErr) {
    return htmlError(`MAJ settings echouee : ${updErr.message}`, 500);
  }

  // Redirect vers le frontend avec confirmation
  return new Response(null, {
    status: 302,
    headers: { Location: `${state.returnTo}/geogrid?gsc=connected` },
  });
});
