// ============================================================================
// mailing-send v12 — batching + throttle Resend + retry 429
// ============================================================================
// Auth interne via authenticate() : MDH_CRON_SECRET (badge cron) OU
// SUPABASE_SERVICE_ROLE_KEY → service_role cross-org ; sinon JWT user valide.
// FIX 2026-06-02 : insertMailingLog écrit via la vue publique
// `majordhome_mailing_logs` (et non .schema('majordhome').from('mailing_logs')
// que PostgREST rejette — le schema majordhome n'est pas exposé → les logs
// étaient perdus silencieusement, cf. gotcha DB).
// FIX 2026-06-12 (v12) — campagne 2617 destinataires coupée à 706 :
//   1. Wall-clock edge ~150s tuait la boucle d'envoi → cap MAX_PER_RUN (300)
//      par invocation. La réponse expose { remaining, complete } : tant que
//      remaining > 0, ré-appeler l'edge avec le même payload — l'exclusion
//      `NOT IN mailing_logs WHERE campaign_name = X` (mail_segment_compile)
//      fait reprendre là où on s'est arrêté, sans doublon.
//   2. Resend rate limit 5 req/s (56 failed « Too many requests ») →
//      throttle MIN_SEND_INTERVAL_MS entre débuts d'envois (~4 req/s)
//      + retry x2 avec backoff sur 429 / erreur réseau.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";

const UNSUB_URL = `${SUPABASE_URL}/functions/v1/mailing-unsubscribe`;
const UNSUB_EXPIRATION_SECONDS = 90 * 24 * 3600;

// v12 — Budget par invocation : 300 envois × 250 ms ≈ 75 s d'envoi + logs DB,
// confortablement sous le wall-clock de 150 s. Override env MAILING_MAX_PER_RUN
// ou payload.batch_limit (borné à 400).
const MAX_PER_RUN = Math.max(
  1,
  Math.min(400, parseInt(Deno.env.get("MAILING_MAX_PER_RUN") || "300", 10) || 300),
);
const MIN_SEND_INTERVAL_MS = 250; // Resend = 5 req/s → on vise ~4 req/s
const RATE_LIMIT_BACKOFF_MS = 1200;

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, x-app-name, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function buildUnsubscribeUrl(
  recipientType: "client" | "lead",
  recipientId: string | null,
  fallbackMailto: string,
): Promise<string> {
  if (!recipientId) return fallbackMailto;
  if (!RESEND_WEBHOOK_SECRET) return fallbackMailto;
  const rt = recipientType === "lead" ? "l" : "c";
  const exp = Math.floor(Date.now() / 1000) + UNSUB_EXPIRATION_SECONDS;
  const payload = `${rt}.${recipientId}.${exp}`;
  const secretPart = RESEND_WEBHOOK_SECRET.startsWith("whsec_")
    ? RESEND_WEBHOOK_SECRET.slice(6)
    : RESEND_WEBHOOK_SECRET;
  const keyBytes = base64Decode(secretPart);
  const sigBytes = await hmacSha256(keyBytes, payload);
  const sigB64url = base64UrlEncode(sigBytes);
  const token = `${payload}.${sigB64url}`;
  return `${UNSUB_URL}?token=${encodeURIComponent(token)}`;
}

type AuthContext = { userId: string | null; isServiceRole: boolean };

async function authenticate(authHeader: string): Promise<AuthContext | null> {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (MDH_CRON_SECRET && timingSafeEqual(token, MDH_CRON_SECRET)) {
    return { userId: null, isServiceRole: true };
  }
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { userId: null, isServiceRole: true };
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { userId: user.id, isServiceRole: false };
}

type Recipient = {
  recipient_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string;
  pellets_total_token: string | null;
  org_id: string;
  recipient_type: "client" | "lead";
};

type FetchResult = {
  recipients: Recipient[];
  orgId: string;
  recipientType: "client" | "lead";
};

async function fetchRecipients(params: {
  mode: "bulk" | "single";
  segmentId?: string;
  clientId?: string;
  campaignName: string;
  authHeader: string;
  isServiceRole: boolean;
}): Promise<FetchResult> {
  const client = params.isServiceRole
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: params.authHeader } },
      });

  const rpcArgs: Record<string, unknown> = {
    p_campaign_name: params.campaignName,
  };
  if (params.mode === "bulk") {
    rpcArgs.p_segment_id = params.segmentId;
    rpcArgs.p_client_id = null;
  } else {
    rpcArgs.p_segment_id = null;
    rpcArgs.p_client_id = params.clientId;
  }

  const { data, error } = await client.rpc("mail_fetch_recipients", rpcArgs);
  if (error) {
    throw new Error(`mail_fetch_recipients failed: ${error.message}`);
  }
  const rows = (data ?? []) as Recipient[];
  if (rows.length === 0) {
    return { recipients: [], orgId: "", recipientType: "client" };
  }
  return {
    recipients: rows,
    orgId: rows[0].org_id,
    recipientType: rows[0].recipient_type,
  };
}

async function resolveOrgIfEmpty(
  segmentId?: string,
  clientId?: string,
): Promise<{ orgId: string; recipientType: "client" | "lead" } | null> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (segmentId) {
    const { data } = await admin
      .schema("majordhome").from("mail_segments")
      .select("org_id, audience").eq("id", segmentId).maybeSingle();
    if (!data?.org_id) return null;
    return {
      orgId: data.org_id as string,
      recipientType: (data.audience === "leads" ? "lead" : "client") as "client" | "lead",
    };
  }
  if (clientId) {
    const { data } = await admin
      .schema("majordhome").from("clients")
      .select("org_id").eq("id", clientId).maybeSingle();
    if (!data?.org_id) return null;
    return { orgId: data.org_id as string, recipientType: "client" };
  }
  return null;
}

type OrgBranding = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  brandName: string;
  websiteUrl: string;
  pelletsOfferUrl: string | null;
  contactEmail: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  accentColor: string;
  secondaryColor: string;
  emailTagline: string;
  logoUrl: string;
  emailSkeleton: string | null;
};

async function loadOrgBranding(orgId: string): Promise<OrgBranding> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: org } = await admin
    .schema("core").from("organizations")
    .select("settings").eq("id", orgId).maybeSingle();
  const s = ((org?.settings as Record<string, unknown> | null) ?? {}) as Record<string, string>;
  const contactEmail = s.from_email || s.reply_to || "contact@mayer-energie.fr";
  return {
    fromName: s.from_name || s.brand_name || "Majord'home",
    fromEmail: s.from_email || contactEmail,
    replyTo: s.reply_to || contactEmail,
    brandName: s.brand_name || "Majord'home",
    websiteUrl: s.website_url || "https://www.mayer-energie.fr",
    pelletsOfferUrl: s.pellets_offer_url || null,
    contactEmail,
    phone: s.phone || "",
    address: s.address || "",
    postalCode: s.postal_code || "",
    city: s.city || "",
    accentColor: s.accent_color || "#f97316",
    secondaryColor: s.secondary_color || "#1E4D8C",
    emailTagline: s.email_tagline || "",
    logoUrl: s.logo_url || "",
    emailSkeleton: s.email_skeleton_html || null,
  };
}

function wrapInSkeleton(body: string, branding: OrgBranding): string {
  if (!branding.emailSkeleton) return body;
  if (/<!doctype/i.test(body) || /<html[\s>]/i.test(body)) return body;
  return branding.emailSkeleton.replace("{{EMAIL_BODY}}", body);
}

function applyPlaceholders(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(key).join(value);
  }
  return out;
}

type SendResult = { providerId: string | null; errorMessage: string | null };

async function sendViaResend(params: {
  branding: OrgBranding;
  to: string;
  subject: string;
  html: string;
  listUnsubscribeHeader: string;
}): Promise<SendResult> {
  const body = {
    from: `${params.branding.fromName} <${params.branding.fromEmail}>`,
    to: [params.to],
    reply_to: params.branding.replyTo,
    subject: params.subject,
    html: params.html,
    headers: {
      "List-Unsubscribe": params.listUnsubscribeHeader,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  // v12 : jusqu'à 3 tentatives — backoff sur 429 (rate limit Resend) et
  // sur erreur réseau transitoire. Les erreurs définitives (4xx autres)
  // sortent immédiatement.
  let lastError = "unknown";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        lastError = String(data?.message || "Resend rate limit (429)");
        if (attempt < 2) {
          await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
          continue;
        }
        break;
      }
      if (!res.ok || !data?.id) {
        const msg = data?.message || data?.error?.message || data?.name || `Resend HTTP ${res.status}`;
        return { providerId: null, errorMessage: String(msg).substring(0, 500) };
      }
      return { providerId: data.id, errorMessage: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
    }
  }
  return { providerId: null, errorMessage: lastError.substring(0, 500) };
}

async function insertMailingLog(params: {
  recipientType: "client" | "lead";
  recipientId: string | null;
  orgId: string;
  campaignName: string;
  subject: string;
  emailTo: string;
  result: SendResult;
}) {
  if (!params.recipientId || !params.orgId) return;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const row: Record<string, unknown> = {
    org_id: params.orgId,
    campaign_name: params.campaignName,
    subject: params.subject,
    email_to: params.emailTo,
    sent_at: new Date().toISOString(),
    status: params.result.providerId ? "sent" : "failed",
    provider_id: params.result.providerId,
    error_message: params.result.errorMessage,
  };
  if (params.recipientType === "lead") {
    row.lead_id = params.recipientId;
  } else {
    row.client_id = params.recipientId;
  }
  // Via la vue publique (le schema majordhome n'est pas exposé via PostgREST).
  const { error } = await admin.from("majordhome_mailing_logs").insert(row);
  if (error) {
    console.error("[mailing-send] mailing_logs insert failed:", error);
  }
}

function buildSalutation(r: { first_name: string | null; last_name: string | null }): string {
  const fullName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return fullName ? `Bonjour ${fullName},` : "Bonjour,";
}

function buildPelletsLink(
  r: { pellets_total_token: string | null },
  campaignName: string,
  branding: OrgBranding,
): string {
  const baseUrl = branding.pelletsOfferUrl || `${branding.websiteUrl}/offre-pellets`;
  const campaignSlug = String(campaignName || "custom")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const utm = `utm_source=emailing&utm_campaign=${encodeURIComponent(campaignSlug)}&utm_medium=email`;
  const token = (r.pellets_total_token || "").trim();
  return token ? `${baseUrl}?token=${encodeURIComponent(token)}&${utm}` : `${baseUrl}?${utm}`;
}

function buildRecipientReplacements(
  r: { first_name: string | null; last_name: string | null; display_name: string | null },
  branding: OrgBranding,
): Record<string, string> {
  const clientName =
    r.display_name?.trim() ||
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
    "cher client";
  return {
    "{{CLIENT_NAME}}": clientName,
    "{{BRAND_NAME}}": branding.brandName,
    "{{ORG_EMAIL}}": branding.contactEmail,
    "{{ORG_PHONE}}": branding.phone,
    "{{ORG_ADDRESS}}": branding.address,
    "{{ORG_POSTAL_CODE}}": branding.postalCode,
    "{{ORG_CITY}}": branding.city,
    "{{ORG_WEBSITE_URL}}": branding.websiteUrl,
    "{{ACCENT_COLOR}}": branding.accentColor,
    "{{SECONDARY_COLOR}}": branding.secondaryColor,
    "{{EMAIL_TAGLINE}}": branding.emailTagline,
    "{{LOGO_URL}}": branding.logoUrl,
  };
}

function personalizeHtml(params: {
  htmlBody: string;
  salutation: string;
  lienPellets: string;
  unsubscribeUrl: string;
  contactEmail: string;
  brandingReplacements: Record<string, string>;
}): string {
  let html = params.htmlBody;
  html = applyPlaceholders(html, params.brandingReplacements);
  html = html.replace(/\{\{SALUTATION\}\}/g, params.salutation);
  html = html.replace(/\{\{lien_pellets\}\}/g, params.lienPellets);
  const escapedEmail = params.contactEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mailtoRegex = new RegExp(`mailto:${escapedEmail}\\?subject=D[eé]sabonnement`, "gi");
  html = html.replace(mailtoRegex, params.unsubscribeUrl);
  return html;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed — use POST" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return jsonResponse({ error: "No auth header" }, 401);

  const auth = await authenticate(authHeader);
  if (!auth) return jsonResponse({ error: "Unauthorized" }, 401);

  if (!RESEND_API_KEY) {
    return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const mode = String(payload.mode || "bulk").toLowerCase() as "bulk" | "single";
  const segmentId = payload.segment_id ? String(payload.segment_id) : undefined;
  const clientId = payload.client_id ? String(payload.client_id) : undefined;
  const subject = String(payload.subject || "").trim();
  const htmlBody = String(payload.html_body || "");
  const campaignName = String(payload.campaign_name || "custom");
  const testEmail = payload.test_email ? String(payload.test_email).trim() : null;

  if (!subject) return jsonResponse({ error: "subject required" }, 400);
  if (!htmlBody) return jsonResponse({ error: "html_body required" }, 400);
  if (mode !== "bulk" && mode !== "single") {
    return jsonResponse({ error: "mode must be 'bulk' or 'single'" }, 400);
  }
  if (mode === "bulk" && !segmentId) {
    return jsonResponse({ error: "segment_id required for mode=bulk" }, 400);
  }
  if (mode === "single" && !clientId) {
    return jsonResponse({ error: "client_id required for mode=single" }, 400);
  }

  try {
    const fetched = await fetchRecipients({
      mode, segmentId, clientId, campaignName, authHeader,
      isServiceRole: auth.isServiceRole,
    });

    let { recipients, orgId, recipientType } = fetched;

    if (testEmail) {
      const resolved = orgId
        ? { orgId, recipientType }
        : await resolveOrgIfEmpty(segmentId, clientId);
      if (!resolved) {
        return jsonResponse({ error: "Cannot resolve org_id for test mode" }, 400);
      }
      orgId = resolved.orgId;
      recipientType = resolved.recipientType;
      recipients = [
        {
          recipient_id: "",
          first_name: "Test",
          last_name: "Destinataire",
          display_name: "Test Destinataire",
          email: testEmail,
          pellets_total_token: null,
          org_id: orgId,
          recipient_type: recipientType,
        },
      ];
    }

    if (recipients.length === 0) {
      return jsonResponse({
        success: true, test_mode: false, total: 0, sent: 0, failed: 0,
        total_eligible: 0, processed: 0, remaining: 0, complete: true,
        note: "Aucun destinataire éligible — segment vide après filtres.",
      });
    }

    const branding = await loadOrgBranding(orgId);

    // v12 — cap par invocation pour rester sous le wall-clock edge (~150 s).
    // Les destinataires non traités restent éligibles : l'exclusion campagne
    // courante (mailing_logs) garantit la reprise sans doublon au run suivant.
    const totalEligible = recipients.length;
    const batchLimitRaw = Number(payload.batch_limit);
    const perRun = Number.isFinite(batchLimitRaw) && batchLimitRaw >= 1
      ? Math.min(Math.floor(batchLimitRaw), 400)
      : MAX_PER_RUN;
    const batch = recipients.slice(0, perRun);

    let sentCount = 0;
    let failedCount = 0;
    let lastSendStart = 0;
    for (const r of batch) {
      const toEmail = testEmail || r.email;
      if (!toEmail) {
        failedCount++;
        continue;
      }

      // v12 — throttle : plancher entre débuts d'envois (~4 req/s < 5 req/s Resend)
      const waitMs = lastSendStart + MIN_SEND_INTERVAL_MS - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      lastSendStart = Date.now();

      const recipientIdForLog = testEmail ? null : r.recipient_id;
      const salutation = buildSalutation(r);
      const lienPellets = buildPelletsLink(r, campaignName, branding);
      const unsubscribeUrl = await buildUnsubscribeUrl(
        recipientType, recipientIdForLog,
        `mailto:${branding.contactEmail}?subject=Désabonnement`,
      );
      const listUnsubscribeHeader =
        `<${unsubscribeUrl}>, <mailto:${branding.contactEmail}?subject=Désabonnement>`;

      const brandingReplacements = buildRecipientReplacements(r, branding);
      const personalizedSubject = applyPlaceholders(subject, brandingReplacements);

      const wrappedHtml = wrapInSkeleton(htmlBody, branding);

      const html = personalizeHtml({
        htmlBody: wrappedHtml, salutation, lienPellets, unsubscribeUrl,
        contactEmail: branding.contactEmail,
        brandingReplacements,
      });

      const sendResult = await sendViaResend({
        branding, to: toEmail, subject: personalizedSubject, html, listUnsubscribeHeader,
      });

      if (sendResult.providerId) sentCount++;
      else failedCount++;

      await insertMailingLog({
        recipientType, recipientId: recipientIdForLog, orgId, campaignName,
        subject: personalizedSubject, emailTo: toEmail, result: sendResult,
      });
    }

    const processed = batch.length;
    const remaining = totalEligible - processed;
    console.log(
      `[mailing-send] campaign="${campaignName}" eligible=${totalEligible} processed=${processed} sent=${sentCount} failed=${failedCount} remaining=${remaining}`,
    );

    return jsonResponse({
      success: true, test_mode: !!testEmail,
      total: processed, sent: sentCount, failed: failedCount,
      total_eligible: totalEligible, processed, remaining,
      complete: remaining === 0,
    });
  } catch (err) {
    console.error("[mailing-send] error:", err);
    return jsonResponse(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
