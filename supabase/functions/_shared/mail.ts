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
  fromEmail: string;
  replyTo: string;
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
 * Reproduit `loadOrgBranding` de `mailing-send/index.ts:226-251` — mêmes clés
 * et mêmes défauts de couleur. PAS de fallback Mayer sur `fromEmail` :
 * `settings.from_email || settings.reply_to || ''` — vide ⇒ l'appelant refuse
 * l'envoi (cf. spec, prérequis techniques).
 */
export function orgBranding(settings: Record<string, unknown>): OrgBranding {
  const s = (settings ?? {}) as Record<string, string>;
  const fromEmail = s.from_email || s.reply_to || "";
  return {
    fromName: s.from_name || s.brand_name || "",
    fromEmail,
    replyTo: s.reply_to || fromEmail,
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
    "{{ORG_EMAIL}}": b.fromEmail,
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
 * Enveloppe `body` dans le squelette `{{EMAIL_BODY}}` de l'org, sauf si `body`
 * est déjà un HTML complet (rétrocompat gabarits legacy, cf.
 * `contract-signed-notify`).
 */
export function wrapWithSkeleton(b: OrgBranding, body: string): string {
  if (!b.skeleton || !b.skeleton.includes("{{EMAIL_BODY}}")) return body;
  if (/<html[\s>]/i.test(body)) return body;
  return b.skeleton.replace("{{EMAIL_BODY}}", body);
}

export interface ResendAttachment {
  filename: string;
  content: string;
}

export interface ResendPayload {
  from: string;
  to: string[];
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
