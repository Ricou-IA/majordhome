// ============================================================================
// _shared/mail.ts — Helper e-mail Resend pour les edge functions Majord'home
// ============================================================================
//
// Sans dépendance à `mailing-send` (celle-ci reste inchangée, cf. spec
// 2026-09-23-facture-entretien-envoi-email-resend-design.md § Réutilisation).
// Reprend les patterns déjà éprouvés de `contract-signed-notify/index.ts`
// (arrayBufferToBase64, applyPlaceholders, sanitizeFilename, squelette
// {{EMAIL_BODY}}) et de `mailing-send/index.ts:226-251` (loadOrgBranding —
// mêmes clés, mêmes défauts de couleur) — SANS fallback Mayer sur
// `fromEmail` : une org sans `from_email`/`reply_to` renvoie `''`, à
// l'appelant de refuser l'envoi (cf. `invoice-send`).
// ============================================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resoudreExpediteur } from "./expediteur.js";

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
  address: string;
  postalCode: string;
  city: string;
  websiteUrl: string;
  accentColor: string;
  secondaryColor: string;
  emailTagline: string;
  logoUrl: string;
  skeleton: string | null;
}

/**
 * Identité d'envoi et habillage d'un e-mail INDIVIDUEL de l'organisation. L'expéditeur est résolu
 * par `expediteurDe` : `fromEmail` vide ⇒ l'entreprise n'a aucune adresse, l'appelant refuse l'envoi
 * (`no_from_email`). Jamais l'adresse d'une autre entreprise.
 */
export function orgBranding(settings: Record<string, unknown>): OrgBranding {
  const s = (settings ?? {}) as Record<string, string>;
  const exp = expediteurDe(settings);
  return {
    fromName: exp.fromName,
    fromEmail: exp.fromEmail,
    replyTo: exp.replyTo,
    contactEmail: exp.contactEmail,
    brandName: s.brand_name || "",
    phone: s.phone || "",
    address: s.address || "",
    postalCode: s.postal_code || "",
    city: s.city || "",
    websiteUrl: s.website_url || "",
    accentColor: s.accent_color || "#f97316",
    secondaryColor: s.secondary_color || "#1E4D8C",
    emailTagline: s.email_tagline || "",
    logoUrl: s.logo_url || "",
    skeleton: s.email_skeleton_html || null,
  };
}

export function brandingReplacements(b: OrgBranding): Record<string, string> {
  return {
    "{{BRAND_NAME}}": b.brandName,
    "{{ORG_EMAIL}}": b.contactEmail,
    "{{ORG_PHONE}}": b.phone,
    "{{ORG_ADDRESS}}": b.address,
    "{{ORG_POSTAL_CODE}}": b.postalCode,
    "{{ORG_CITY}}": b.city,
    "{{ORG_WEBSITE_URL}}": b.websiteUrl,
    "{{ACCENT_COLOR}}": b.accentColor,
    "{{SECONDARY_COLOR}}": b.secondaryColor,
    "{{EMAIL_TAGLINE}}": b.emailTagline,
    "{{LOGO_URL}}": b.logoUrl,
  };
}

/**
 * Habillage par défaut d'une entreprise qui n'a pas le sien : son nom (ou son logo) en tête, ses
 * coordonnées en pied, tons neutres. Les valeurs sont posées ici, échappées — il ne reste aucune
 * variable à remplacer par l'appelant.
 */
function habillageNeutre(b: OrgBranding, body: string): string {
  const nom = escapeHtml(b.brandName);
  const logo = /^https:\/\//i.test(b.logoUrl)
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${nom}" style="max-height:56px;max-width:220px;">`
    : (nom ? `<span style="font-size:18px;font-weight:600;color:#0f172a;">${nom}</span>` : "");
  const adresse = [b.address, [b.postalCode, b.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const pied = [b.brandName, adresse, b.phone, b.contactEmail].filter(Boolean).map(escapeHtml).join(" · ");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f1f5f9;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e293b;">`
    + (logo ? `<tr><td style="padding:24px 28px 0 28px;">${logo}</td></tr>` : "")
    + `<tr><td style="padding:24px 28px;">${body}</td></tr>`
    + (pied ? `<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">${pied}</td></tr>` : "")
    + `</table></td></tr></table></body></html>`;
}

/**
 * Enveloppe `body` dans l'habillage de l'org (`email_skeleton_html`, variable `{{EMAIL_BODY}}`), à
 * défaut dans l'habillage neutre — sauf si `body` est déjà un HTML complet (gabarits legacy, cf.
 * `contract-signed-notify`).
 */
export function wrapWithSkeleton(b: OrgBranding, body: string): string {
  if (/<html[\s>]/i.test(body)) return body;
  if (!b.skeleton || !b.skeleton.includes("{{EMAIL_BODY}}")) return habillageNeutre(b, body);
  return b.skeleton.replace("{{EMAIL_BODY}}", body);
}

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
