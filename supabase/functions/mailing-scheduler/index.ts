// ============================================================================
// mailing-scheduler — Cron des campagnes mailing automatiques (toutes orgs)
// ============================================================================
//
// Remplace le workflow N8n "Mayer - Scheduler Campagnes Auto" (régression :
// son étape d'envoi n'avait jamais été recâblée vers `mailing-send` après la
// migration P0.8 V2 du 21/05/2026 → 0 envoi auto depuis cette date alors que
// le mark_run continuait de tourner, masquant la panne).
//
// Pattern : pg_cron (toutes les 10 min) → cette edge (verify_jwt:false,
// protégée par MDH_CRON_SECRET) → pour chaque campagne due :
//   1. POST mailing-send (mode bulk, service_role) → envoi réel
//   2. mail_campaign_mark_run → avance last_run_at / next_run_at
//
// App-level cross-org : `mail_campaigns_due()` renvoie les campagnes dues de
// TOUTES les orgs (chaque ligne porte son org_id) → 1 cron pour toutes.
//
// Body optionnel : { dry_run: true } → liste les campagnes dues + le nombre de
// destinataires SANS rien envoyer (pré-vérification avant blast réel).
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET.
// ============================================================================

import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const MAILING_SEND_URL = `${SUPABASE_URL}/functions/v1/mailing-send`;

interface DueCampaign {
  campaign_id: string;
  org_id: string;
  campaign_key: string;
  campaign_label: string;
  subject: string;
  html_body: string;
  segment_id: string;
  segment_name: string;
  segment_filters: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body vide = run réel (le cron envoie '{}')
  }
  const dryRun = body?.dry_run === true;

  const admin = getAdminClient();

  // 1. Campagnes dues (toutes orgs)
  const { data: due, error: dueErr } = await admin.rpc("mail_campaigns_due");
  if (dueErr) {
    return jsonResponse({ error: `mail_campaigns_due failed: ${dueErr.message}` }, 500, req);
  }
  const campaigns = (due ?? []) as DueCampaign[];

  const results: Array<Record<string, unknown>> = [];

  for (const c of campaigns) {
    try {
      if (dryRun) {
        // Compte destinataires sans envoyer
        const { data: cnt } = await admin.rpc("mail_segment_count", {
          p_filters: c.segment_filters,
          p_campaign_name: c.campaign_label,
          p_org_id: c.org_id,
        });
        results.push({
          campaign: c.campaign_label,
          segment: c.segment_name,
          org_id: c.org_id,
          would_send: typeof cnt === "number" ? cnt : null,
        });
        continue;
      }

      // Envoi réel via mailing-send (service_role → bypass membership, cross-org)
      const resp = await fetch(MAILING_SEND_URL, {
        method: "POST",
        headers: {
          // mailing-send est verify_jwt:false : on s'authentifie via le badge de
          // service cron (MDH_CRON_SECRET), qu'il accepte comme service_role
          // (cross-org). Pas d'apikey nécessaire sur une edge verify_jwt:false.
          "Authorization": `Bearer ${MDH_CRON_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "bulk",
          segment_id: c.segment_id,
          subject: c.subject,
          html_body: c.html_body,
          campaign_name: c.campaign_label,
        }),
      });
      const rawText = await resp.text();
      let sendData: Record<string, unknown> = {};
      try {
        sendData = JSON.parse(rawText);
      } catch {
        // réponse non-JSON (ex: rejet gateway) → on garde rawText pour diag
      }

      // Avance le planning UNIQUEMENT si l'appel mailing-send a abouti (HTTP 2xx).
      // Un échec HTTP total (gateway, 5xx) ne doit PAS consommer la fenêtre →
      // la campagne reste due et retentera au prochain cycle (self-healing).
      // (Les échecs PAR DESTINATAIRE sont gérés dans mailing-send : loggés +
      // exclus du segment au prochain passage, donc pas de re-blast.)
      let markErr = null;
      if (resp.ok) {
        const r = await admin.rpc("mail_campaign_mark_run", { p_campaign_id: c.campaign_id });
        markErr = r.error;
      }

      results.push({
        campaign: c.campaign_label,
        org_id: c.org_id,
        http_ok: resp.ok,
        marked_run: resp.ok,
        total: sendData?.total ?? null,
        sent: sendData?.sent ?? null,
        failed: sendData?.failed ?? null,
        send_error: resp.ok ? null : (sendData?.error ?? rawText.slice(0, 300) ?? `HTTP ${resp.status}`),
        mark_run_error: markErr?.message ?? null,
      });
    } catch (err) {
      results.push({
        campaign: c.campaign_label,
        org_id: c.org_id,
        error: sanitizeError(err, "campaign processing failed"),
      });
    }
  }

  return jsonResponse(
    { dry_run: dryRun, due: campaigns.length, results },
    200,
    req,
  );
});
