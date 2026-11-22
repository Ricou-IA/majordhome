// ============================================================================
// _shared/mail.ts — Helper e-mail Resend pour les edge functions Majord'home
// ============================================================================
//
// Sans dépendance à `mailing-send` (celle-ci reste inchangée, cf. spec
// 2026-09-23-facture-entretien-envoi-email-resend-design.md § Réutilisation).
// Reprend les patterns déjà éprouvés de `contract-signed-notify/index.ts`
// (arrayBufferToBase64, applyPlaceholders, sanitizeFilename). L'habillage et les
// valeurs de marque viennent de `mailHabillage.js` (une seule définition) — SANS fallback Mayer sur
// `fromEmail` : une org sans `from_email`/`reply_to` renvoie `''`, à
// l'appelant de refuser l'envoi (cf. `invoice-send`).
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resoudreExpediteur } from "./expediteur.js";
import { habillerMail, valeursDeMarque } from "./mailHabillage.js";

/**
 * Expéditeur d'un e-mail de l'organisation — seule lecture de l'adresse commune de la plateforme
 * (secret `MDH_PLATFORM_FROM_EMAIL`). Règles : `_shared/expediteur.js` (copie de `src/lib/expediteur.js`).
 */
export function expediteurDe(settings: Record<string, unknown> | null, usage: "individuel" | "nombre" = "individuel") {
  let plateforme = "";
  try {
    plateforme = Deno.env.get("MDH_PLATFORM_FROM_EMAIL") || "";
  } catch {
    // Environnement illisible (tests lancés sans --allow-env) : pas d'adresse commune.
  }
  return resoudreExpediteur(settings ?? {}, { usage, plateforme });
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function applyPlaceholders(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(key).join(value);
  }
  return out;
}

export function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9À-ÿ_\-]/g, "_").replace(/_+/g, "_");
}

/** Échappe `& < > " '` — pour insérer une valeur texte (jamais une URL/couleur) dans un gabarit HTML. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface OrgBranding {
  fromName: string;
  /** Adresse d'où part l'e-mail : celle de l'entreprise, ou l'adresse commune tant que son domaine n'est pas vérifié. */
  fromEmail: string;
  replyTo: string;
  /** Adresse de l'entreprise, à écrire dans le corps d'un e-mail — jamais l'adresse commune. */
  contactEmail: string;
  brandName: string;
  phone: string;
  /** Réglages bruts de l'organisation : l'habillage et les valeurs de marque s'en déduisent (`mailHabillage.js`). */
  reglages: Record<string, unknown>;
}

/**
 * Identité d'envoi d'un e-mail INDIVIDUEL de l'organisation. L'expéditeur est résolu par
 * `expediteurDe` : `fromEmail` vide ⇒ l'entreprise n'a aucune adresse, l'appelant refuse l'envoi
 * (`no_from_email`). Jamais l'adresse d'une autre entreprise. Habillage et valeurs de marque : une seule
 * définition, `_shared/mailHabillage.js`.
 */
export function orgBranding(settings: Record<string, unknown>): OrgBranding {
  const reglages = settings ?? {};
  const exp = expediteurDe(reglages);
  const marque = valeursDeMarque(reglages);
  return {
    fromName: exp.fromName,
    fromEmail: exp.fromEmail,
    replyTo: exp.replyTo,
    contactEmail: exp.contactEmail,
    brandName: marque["{{BRAND_NAME}}"],
    phone: marque["{{ORG_PHONE}}"],
    reglages,
  };
}

/** Les valeurs de marque de l'entreprise, par variable `{{…}}` — `valeursDeMarque`, seule définition. */
export function brandingReplacements(b: OrgBranding): Record<string, string> {
  return valeursDeMarque(b.reglages);
}

/**
 * Habille `body` : l'habillage de l'entreprise (celui qu'elle a construit, sinon son ancien
 * habillage enregistré, sinon l'habillage par défaut) — sauf si `body` est déjà un HTML complet
 * (gabarits legacy, cf. `contract-signed-notify`). Règles : `habillerMail`, seule définition.
 * `options.usage` : `campagne` pour un e-mail du Mailing (blocs « sur vos campagnes ») ; absent = individuel.
 */
export function wrapWithSkeleton(b: OrgBranding, body: string, options?: OptionsHabillage): string {
  return habillerMail(b.reglages, body, options);
}

/** Options d'habillage (`usage`), cf. `habillerMail`. */
type OptionsHabillage = { usage?: "campagne" | "individuel" };

export interface ResendAttachment {
  filename: string;
  content: string;
}

export interface ResendPayload {
  from: string;
  to: string[];
  /** Copie visible (ex. ordre colis : e-mails internes de l'org). Ignorée si vide. */
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: ResendAttachment[];
}

export interface ResendResult {
  ok: boolean;
  status: number;
  id: string | null;
  message: string | null;
}

/** POST https://api.resend.com/emails — ne throw jamais, renvoie { ok, status, id, message }. */
export async function sendResendEmail(apiKey: string, payload: ResendPayload): Promise<ResendResult> {
  const body: Record<string, unknown> = {
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.cc?.length) body.cc = payload.cc;
  if (payload.replyTo) body.reply_to = payload.replyTo;
  if (payload.attachments?.length) body.attachments = payload.attachments;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let data: { id?: string; message?: string } = {};
    try {
      data = await res.json();
    } catch {
      // Resend a renvoyé du non-JSON (timeout, etc.)
    }
    return {
      ok: res.ok,
      status: res.status,
      id: data.id || null,
      message: res.ok ? null : (data.message || `Resend HTTP ${res.status}`),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      id: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface MailingLogRow {
  client_id?: string | null;
  lead_id?: string | null;
  org_id: string;
  campaign_name: string;
  subject: string;
  email_to: string;
  status: "sent" | "failed";
  provider_id?: string | null;
  error_message?: string | null;
}

/**
 * Insert sur `majordhome_mailing_logs` (vue publique, comme
 * `contract-signed-notify:251-266`). Retourne `null` si OK, un message
 * `sanitizeError`-friendly sinon — jamais bloquant pour l'appelant.
 */
export async function insertMailingLog(
  supabase: SupabaseClient,
  row: MailingLogRow,
): Promise<string | null> {
  const { error } = await supabase.from("majordhome_mailing_logs").insert(row);
  if (!error) return null;
  return error.message || "mailing_logs insert failed";
}
