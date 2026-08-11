// ============================================================================
// sms-send — envoi SMS / WhatsApp transactionnel, multi-org
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
// MODELE FOURNISSEUR : Twilio est mutualise cote plateforme (un seul compte,
// en sous-traitance technique), exactement comme RESEND_API_KEY. Ce qui est
// propre a chaque client n'est pas la CLE mais l'IDENTITE D'EXPEDITEUR :
// numero WhatsApp, nom d'expediteur SMS, domaine du lien court, gabarits.
// Tout cela vit dans core.organizations.settings.sms — donc editable, donc
// onboardable sans redeploiement.
//
// ⚠ Le nom d'expediteur alphanumerique (ex. « Mayer-SAV ») doit etre declare
// par marque aupres de l'operateur en France. Mutualiser le compte n'y change
// rien : c'est une etape d'onboarding, au meme titre que la verification de
// domaine chez Resend.
//
// Body : { campaign, phone, client_id?, intervention_id?, vars? }
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireOrgMembership,
  getAdminClient,
  jsonResponse,
  buildCorsHeaders,
  sanitizeError,
} from "../_shared/auth.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";

// Alphabet sans caracteres ambigus (ni O/0, ni I/l/1) : ces codes sont lus a
// voix haute ou recopies a la main depuis un SMS.
const SHORT_CODE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const SHORT_CODE_LENGTH = 6;

interface SmsTemplate {
  whatsapp?: string;
  sms?: string;
  /**
   * Retire les accents du message rendu. Un SMS accentue bascule en UCS-2 :
   * 70 caracteres par segment au lieu de 160, donc plus de segments donc plus
   * cher. Le workflow N8N le faisait deja ; c'est ici un reglage explicite au
   * lieu d'une ligne de code cachee.
   */
  deburr?: boolean;
}

interface SmsSettings {
  enabled?: boolean;
  whatsapp_from?: string;
  sms_from?: string;
  short_link_base?: string;
  templates?: Record<string, SmsTemplate>;
}

// ---------------------------------------------------------------------------
// Helpers purs
// ---------------------------------------------------------------------------

function generateShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  return out;
}

/**
 * Normalisation FR vers le format E.164 attendu par Twilio.
 * ⚠ COPIE de la logique de src/lib/phoneUtils.js — Deno ne peut pas importer le
 * code frontend. Toute correction doit toucher LES DEUX.
 */
function toE164FR(raw: string): string | null {
  const cleaned = (raw || "").replace(/[\s.\-()]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  if (cleaned.startsWith("0")) return "+33" + cleaned.slice(1);
  if (cleaned.startsWith("33")) return "+" + cleaned;
  return null;
}

/**
 * Substitution {{cle}} — les cles absentes sont remplacees par du vide, puis on
 * recolle la ponctuation restee orpheline.
 *
 * Le nettoyage n'est pas cosmetique : un gabarit « Bonjour {{full_name}}, ... »
 * rendu pour un client sans nom donnerait « Bonjour , ... ». Le workflow N8N
 * gerait ce cas par un `if` en dur ; ici, on rend le gabarit inconditionnel et
 * on repare le rendu. Un gabarit reste ainsi du texte, editable par le client,
 * sans logique conditionnelle a apprendre.
 */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => vars[key] ?? "")
    // ⚠ UNIQUEMENT la virgule et le point. En typographie francaise, « ! ? ; : »
    // prennent une espace AVANT : les inclure ici mangeait « entretien ! » pour
    // le transformer en « entretien! » — constate sur le 1er envoi de test.
    .replace(/[ \t]+([,.])/g, "$1")      // « Bonjour , » -> « Bonjour, »
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Retire les diacritiques : « éàç » -> « eac ». Voir SmsTemplate.deburr. */
function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Twilio — un seul endpoint, le canal se joue sur le prefixe du From/To
// ---------------------------------------------------------------------------

async function sendViaTwilio(
  from: string,
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({ From: from, To: to, Body: body });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || `Twilio HTTP ${res.status}` };
    }
    return { ok: true, sid: data?.sid };
  } catch (e) {
    return { ok: false, error: sanitizeError(e, "Twilio call failed") };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, req);
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
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

  const to = toE164FR(rawPhone);
  if (!to) return jsonResponse({ error: "invalid_phone" }, 400, req);

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
  const template = sms?.templates?.[campaign];

  if (!template || (!template.whatsapp && !template.sms)) {
    return jsonResponse({ error: "campaign_template_missing", campaign }, 400, req);
  }
  if (!sms?.whatsapp_from && !sms?.sms_from) {
    return jsonResponse({ error: "sender_identity_missing" }, 400, req);
  }

  // Lien court : genere seulement si un gabarit s'en sert. Pas de code orphelin
  // en base pour une campagne qui n'en veut pas.
  const usesShortLink = /\{\{\s*short_link\s*\}\}/i.test(
    `${template.whatsapp ?? ""}${template.sms ?? ""}`,
  );
  const shortCode = usesShortLink ? generateShortCode() : null;
  const shortLink = shortCode && sms.short_link_base
    ? `${String(sms.short_link_base).replace(/\/+$/, "")}/${shortCode}`
    : "";

  const renderVars = { ...vars, short_link: shortLink, short_code: shortCode ?? "" };
  const render = (tpl: string) => {
    const out = renderTemplate(tpl, renderVars);
    return template.deburr ? deburr(out) : out;
  };

  const whatsappBody = template.whatsapp ? render(template.whatsapp) : null;
  const smsBody = template.sms ? render(template.sms) : null;

  // Pre-log AVANT envoi : un message parti sans trace est pire qu'une trace
  // sans message. Un 'pending' qui resterait tel quel signale un envoi dont on
  // ignore l'issue — c'est une information, pas un bug.
  const firstBody = whatsappBody ?? smsBody ?? "";
  const firstChannel = whatsappBody && sms.whatsapp_from ? "whatsapp" : "sms";

  const { data: logId, error: logErr } = await admin.rpc("sms_log_create", {
    p_org_id: auth.orgId,
    p_phone_to: to,
    p_message: firstBody,
    p_campaign_name: campaign,
    p_channel: firstChannel,
    p_client_id: clientId,
    p_intervention_id: interventionId,
    p_short_code: shortCode,
  });

  if (logErr) {
    return jsonResponse(
      { error: sanitizeError(logErr, "log create failed") },
      500,
      req,
    );
  }

  // WhatsApp d'abord si l'org en a un, SMS en repli. Le texte differe : le SMS
  // est sans accents et tient en un segment, WhatsApp non — d'ou deux gabarits.
  let sent: { channel: string; sid?: string; body: string } | null = null;
  let lastError: string | null = null;

  if (whatsappBody && sms.whatsapp_from) {
    const r = await sendViaTwilio(
      String(sms.whatsapp_from),
      `whatsapp:${to}`,
      whatsappBody,
    );
    if (r.ok) sent = { channel: "whatsapp", sid: r.sid, body: whatsappBody };
    else lastError = r.error ?? "whatsapp failed";
  }

  if (!sent && smsBody && sms.sms_from) {
    const r = await sendViaTwilio(String(sms.sms_from), to, smsBody);
    if (r.ok) sent = { channel: "sms", sid: r.sid, body: smsBody };
    else lastError = r.error ?? "sms failed";
  }

  const { error: markErr } = await admin.rpc("sms_log_mark_sent", {
    p_log_id: logId,
    p_status: sent ? "sent" : "failed",
    p_channel: sent?.channel ?? null,
    p_provider_sid: sent?.sid ?? null,
    p_message: sent?.body ?? null,
  });

  // La trace est le produit de cette fonction : si elle echoue alors que le
  // message est parti, il faut le savoir — mais sans faire croire a un non-envoi.
  if (markErr) {
    console.error(
      `[sms-send] log ${logId} non cloture alors que l'envoi a ${sent ? "reussi" : "echoue"}:`,
      sanitizeError(markErr, "mark_sent failed"),
    );
  }

  if (!sent) {
    return jsonResponse(
      { success: false, log_id: logId, error: lastError ?? "send_failed" },
      502,
      req,
    );
  }

  return jsonResponse(
    {
      success: true,
      log_id: logId,
      channel: sent.channel,
      provider_sid: sent.sid ?? null,
      short_code: shortCode,
    },
    200,
    req,
  );
});
