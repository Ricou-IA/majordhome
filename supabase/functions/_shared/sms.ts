// ============================================================================
// _shared/sms.ts — cœur d'envoi SMS / WhatsApp multi-org (Twilio + trace sms_logs)
// ============================================================================
//
// Extrait de l'edge `sms-send` (2026-09-12) pour être partagé avec `sms-rappel-rdv`
// (cron). Ce module ne fait AUCUNE authentification et ne lit PAS les settings :
// l'appelant a déjà résolu l'org (membership utilisateur pour sms-send, secret
// partagé pour le cron) et lui passe `settings.sms`. Il fait, dans l'ordre :
//   1. normalisation E.164 du numéro, choix du gabarit de la campagne ;
//   2. rendu {{variable}} (+ lien court si le gabarit s'en sert, + deburr) ;
//   3. pré-log `sms_log_create` AVANT l'appel fournisseur ;
//   4. WhatsApp si l'org a un numéro, SMS en repli ;
//   5. clôture `sms_log_mark_sent` (sent / failed, texte réellement parti).
//
// MODELE FOURNISSEUR : Twilio est mutualise cote plateforme (un seul compte,
// en sous-traitance technique), exactement comme RESEND_API_KEY. Ce qui est
// propre a chaque client n'est pas la CLE mais l'IDENTITE D'EXPEDITEUR :
// numero WhatsApp, nom d'expediteur SMS, domaine du lien court, gabarits.
// Tout cela vit dans core.organizations.settings.sms — donc editable
// (Settings → Organisation → SMS), donc onboardable sans redeploiement.
//
// ⚠ Le nom d'expediteur alphanumerique (ex. « Mayer-SAV ») doit etre declare
// par marque aupres de l'operateur en France. Mutualiser le compte n'y change
// rien : c'est une etape d'onboarding, au meme titre que la verification de
// domaine chez Resend.
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sanitizeError } from "./auth.ts";

export const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
export const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";

export function twilioConfigured(): boolean {
  return !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN;
}

// Alphabet sans caracteres ambigus (ni O/0, ni I/l/1) : ces codes sont lus a
// voix haute ou recopies a la main depuis un SMS.
const SHORT_CODE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const SHORT_CODE_LENGTH = 6;

export interface SmsTemplate {
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

/** Réglage du rappel automatique des RDV (cf. buildRappelRdvConfig du registre). */
export interface RappelRdvSettings {
  mode?: string;
  jour?: number;
  heure?: number;
}

export interface SmsSettings {
  enabled?: boolean;
  whatsapp_from?: string;
  sms_from?: string;
  short_link_base?: string;
  templates?: Record<string, SmsTemplate>;
  rappel_rdv?: RappelRdvSettings;
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
export function toE164FR(raw: string): string | null {
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
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => vars[key] ?? "")
    // ⚠ UNIQUEMENT la virgule et le point. En typographie francaise, « ! ? ; : »
    // prennent une espace AVANT : les inclure ici mangeait « entretien ! » pour
    // le transformer en « entretien! » — constate sur le 1er envoi de test.
    .replace(/[ \t]+([,.])/g, "$1")      // « Bonjour , » -> « Bonjour, »
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Retire les diacritiques : « éàç » -> « eac ». Voir SmsTemplate.deburr.
 * ⚠ Même règle que `deburrSms` du registre front (src/lib/smsCampaigns.js), qui
 * sert au compteur de segments de l'onglet SMS : toute évolution touche les deux.
 */
export function deburr(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
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
// Envoi d'une campagne
// ---------------------------------------------------------------------------

export interface SendCampaignParams {
  /** Org CORE (celle des settings et de sms_logs.org_id). */
  orgId: string;
  /** `settings.sms` de l'org, tel que relu par l'appelant. */
  sms: SmsSettings | undefined;
  campaign: string;
  /** Numéro brut (national ou international) : normalisé ici. */
  phone: string;
  clientId?: string | null;
  interventionId?: string | null;
  vars?: Record<string, string>;
}

export type SendCampaignResult =
  | {
    ok: true;
    logId: string;
    channel: string;
    providerSid: string | null;
    shortCode: string | null;
  }
  | {
    ok: false;
    /** Statut HTTP que l'appelant peut relayer tel quel. */
    status: number;
    /** Code stable : invalid_phone | campaign_template_missing | sender_identity_missing | send_failed | … */
    error: string;
    logId?: string | null;
  };

export async function sendCampaignSms(
  admin: SupabaseClient,
  p: SendCampaignParams,
): Promise<SendCampaignResult> {
  const to = toE164FR(p.phone);
  if (!to) return { ok: false, status: 400, error: "invalid_phone" };

  const sms = p.sms;
  const template = sms?.templates?.[p.campaign];
  if (!template || (!template.whatsapp && !template.sms)) {
    return { ok: false, status: 400, error: "campaign_template_missing" };
  }
  if (!sms?.whatsapp_from && !sms?.sms_from) {
    return { ok: false, status: 400, error: "sender_identity_missing" };
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

  const renderVars = { ...(p.vars ?? {}), short_link: shortLink, short_code: shortCode ?? "" };
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
    p_org_id: p.orgId,
    p_phone_to: to,
    p_message: firstBody,
    p_campaign_name: p.campaign,
    p_channel: firstChannel,
    p_client_id: p.clientId ?? null,
    p_intervention_id: p.interventionId ?? null,
    p_short_code: shortCode,
  });

  if (logErr) {
    return { ok: false, status: 500, error: sanitizeError(logErr, "log create failed") };
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
      `[sms] log ${logId} non cloture alors que l'envoi a ${sent ? "reussi" : "echoue"}:`,
      sanitizeError(markErr, "mark_sent failed"),
    );
  }

  if (!sent) {
    return { ok: false, status: 502, error: lastError ?? "send_failed", logId: logId as string };
  }

  return {
    ok: true,
    logId: logId as string,
    channel: sent.channel,
    providerSid: sent.sid ?? null,
    shortCode,
  };
}
