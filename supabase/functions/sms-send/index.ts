// ============================================================================
// sms-send — envoi SMS / WhatsApp transactionnel, multi-org (appel utilisateur)
// ============================================================================
//
// Remplace les workflows N8N « Mayer - SMS Avis Client » et « Mayer - SMS RDV »,
// qui faisaient la meme chose a deux exemplaires : formater un message, tenter
// WhatsApp, retomber sur le SMS, journaliser. Seuls le texte et la campagne
// changeaient. Ici, UNE fonction pilotee par un parametre de campagne.
//
// POURQUOI PAS N8N : un workflow ne sait pas etre multi-client. URL, cles,
// numero d'expediteur et texte y sont poses en dur — un 2e client imposerait un
// 2e jeu de workflows a maintenir. Ils ecrivaient de surcroit dans sms_logs par
// SQL brut interpole, via une connexion Postgres partagee qui contourne la RLS.
//
// Depuis le 2026-09-12, le cœur (rendu, Twilio, trace) vit dans _shared/sms.ts,
// partagé avec le cron `sms-rappel-rdv`. Cette edge ne garde que ce qui est
// propre à l'appel utilisateur : validation du body, membership + garde
// `settings.sms.enabled`, relecture des settings, mise en forme HTTP.
//
// Body : { campaign, phone, client_id?, intervention_id?, vars?, org_id? }
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireOrgMembership,
  getAdminClient,
  jsonResponse,
  buildCorsHeaders,
  sanitizeError,
} from "../_shared/auth.ts";
import { sendCampaignSms, toE164FR, twilioConfigured, type SmsSettings } from "../_shared/sms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, req);
  }

  if (!twilioConfigured()) {
    return jsonResponse({ error: "twilio_not_configured" }, 500, req);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, req);
  }

  const campaign = String(payload.campaign || "").trim();
  const rawPhone = String(payload.phone || "").trim();
  const clientId = (payload.client_id as string) || null;
  const interventionId = (payload.intervention_id as string) || null;
  const vars = (payload.vars as Record<string, string>) || {};

  if (!campaign) return jsonResponse({ error: "campaign_required" }, 400, req);
  if (!toE164FR(rawPhone)) return jsonResponse({ error: "invalid_phone" }, 400, req);

  // Membership + garde « cette org a le SMS actif ». Meme patron que Pennylane :
  // une integration se coupe par un reglage d'org, pas par du code.
  const auth = await requireOrgMembership(req, {
    orgId: (payload.org_id as string) || undefined,
    orgSettingsFilter: (s) => (s.sms as SmsSettings | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;

  const admin = getAdminClient();

  // Les settings ne sont pas renvoyes par le helper : on les relit.
  const { data: orgRow, error: orgErr } = await admin
    .schema("core")
    .from("organizations")
    .select("settings")
    .eq("id", auth.orgId)
    .maybeSingle();

  if (orgErr) {
    return jsonResponse(
      { error: sanitizeError(orgErr, "org settings unreadable") },
      500,
      req,
    );
  }

  const sms = ((orgRow?.settings ?? {}) as Record<string, unknown>)
    .sms as SmsSettings | undefined;

  const result = await sendCampaignSms(admin, {
    orgId: auth.orgId,
    sms,
    campaign,
    phone: rawPhone,
    clientId,
    interventionId,
    vars,
  });

  if (!result.ok) {
    if (result.error === "campaign_template_missing") {
      return jsonResponse({ error: result.error, campaign }, result.status, req);
    }
    if (result.status === 502) {
      return jsonResponse(
        { success: false, log_id: result.logId ?? null, error: result.error },
        502,
        req,
      );
    }
    return jsonResponse({ error: result.error }, result.status, req);
  }

  return jsonResponse(
    {
      success: true,
      log_id: result.logId,
      channel: result.channel,
      provider_sid: result.providerSid,
      short_code: result.shortCode,
    },
    200,
    req,
  );
});
