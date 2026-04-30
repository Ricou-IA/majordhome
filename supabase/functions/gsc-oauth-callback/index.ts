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
// Securite :
//   - verify_jwt: false (callback OAuth public, pas de JWT possible)
//   - state = base64({ orgId, returnTo }) verifie contre la whitelist
//   - refresh_token jamais expose cote client
//   - Echange code -> token cote serveur uniquement
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GSC_CLIENT_ID = Deno.env.get("GSC_CLIENT_ID") || "";
const GSC_CLIENT_SECRET = Deno.env.get("GSC_CLIENT_SECRET") || "";
const FRONTEND_ORIGINS = (Deno.env.get("FRONTEND_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

interface OAuthState {
  orgId: string;
  returnTo: string;
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

  // Decode state
  let state: OAuthState;
  try {
    state = JSON.parse(atob(stateRaw)) as OAuthState;
  } catch {
    return htmlError("State OAuth invalide (decoding failed).");
  }
  if (!state.orgId || !state.returnTo) {
    return htmlError("State OAuth incomplet.");
  }
  if (!isAllowedOrigin(state.returnTo)) {
    return htmlError(`Origin non autorisee : ${state.returnTo}`);
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
