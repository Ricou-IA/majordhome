// ============================================================================
// mailing-send — Edge Function d'envoi de campagnes mailing
// ============================================================================
//
// Remplace le webhook N8n public "Mayer - Mailing" (P0.8 V2).
//
// Interface :
//   POST /functions/v1/mailing-send
//   Authorization: Bearer <supabase_jwt | service_role>
//   Body:
//     {
//       mode: "bulk" | "single",
//       segment_id?: uuid,   // requis si mode="bulk"
//       client_id?: uuid,    // requis si mode="single"
//       subject: string,
//       html_body: string,
//       campaign_name: string,
//       test_email?: string,             // mode test → 1 destinataire factice
//     }
//
// Sécurité :
//   - verify_jwt: true (rejet anonymes)
//   - Le SQL n'est JAMAIS accepté du client. Compilé + exécuté côté DB via
//     RPC SECURITY DEFINER `mail_fetch_recipients` (check membership intégré).
//
// Multi-tenant :
//   - org_id est dérivée du segment ou du client (côté RPC).
//   - from/reply_to/branding chargés depuis core.organizations.settings.
//
// Pipeline (équivalent fidèle du workflow N8n "Mayer - Mailing", id 1COgLUuiMtSq2sUq) :
//   1. Validation payload
//   2. Fetch destinataires via RPC unifiée (compile + exec en interne)
//   3. Mode test → 1 destinataire factice, override email
//   4. Pour chaque destinataire :
//      a. Salutation "Bonjour {first} {last},"
//      b. Lien pellets avec UTM + token éventuel
//      c. Token unsubscribe HMAC SHA256 (compatible mailing-unsubscribe)
//      d. POST Resend
//      e. INSERT mailing_logs
//   5. Retour JSON {total, sent, failed, test_mode}
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

const UNSUB_URL = `${SUPABASE_URL}/functions/v1/mailing-unsubscribe`;
const UNSUB_EXPIRATION_SECONDS = 90 * 24 * 3600;

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

// ---------------------------------------------------------------------------
// HMAC helpers — alignés avec supabase/functions/mailing-unsubscribe/index.ts
// ---------------------------------------------------------------------------

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
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
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

// ---------------------------------------------------------------------------
// Auth — verify JWT user ou service_role
// ---------------------------------------------------------------------------

type AuthContext = { userId: string | null; isServiceRole: boolean };

async function authenticate(authHeader: string): Promise<AuthContext | null> {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { userId: null, isServiceRole: true };
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { userId: user.id, isServiceRole: false };
}

// ---------------------------------------------------------------------------
// Fetch destinataires via RPC (compile + exec + check membership server-side)
// ---------------------------------------------------------------------------

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
  // Si JWT user → init avec ANON_KEY + Authorization header pour que la RPC
  // SECURITY DEFINER puisse lire auth.uid() et faire son check membership.
  // Si service_role → la RPC bypass le check (auth.uid()=NULL).
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
    // Aucun destinataire — on retourne quand même org/type (depuis le segment/client)
    return {
      recipients: [],
      orgId: "",
      recipientType: "client",
    };
  }
  return {
    recipients: rows,
    orgId: rows[0].org_id,
    recipientType: rows[0].recipient_type,
  };
}

// ---------------------------------------------------------------------------
// Resolve org_id si la liste est vide (besoin pour logs/branding)
// ---------------------------------------------------------------------------

async function resolveOrgIfEmpty(
  segmentId?: string,
  clientId?: string,
): Promise<{ orgId: string; recipientType: "client" | "lead" } | null> {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (segmentId) {
    const { data } = await admin
      .schema("majordhome")
      .from("mail_segments")
      .select("org_id, audience")
      .eq("id", segmentId)
      .maybeSingle();
    if (!data?.org_id) return null;
    return {
      orgId: data.org_id as string,
      recipientType: (data.audience === "leads" ? "lead" : "client") as "client" | "lead",
    };
  }
  if (clientId) {
    const { data } = await admin
      .schema("majordhome")
      .from("clients")
      .select("org_id")
      .eq("id", clientId)
      .maybeSingle();
    if (!data?.org_id) return null;
    return { orgId: data.org_id as string, recipientType: "client" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Load branding org
// ---------------------------------------------------------------------------

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
    .schema("core")
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
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

// Wrap le corps du template dans le squelette commun de l'org si applicable.
// Heuristique : on wrap si le squelette est défini ET le body ne contient pas
// déjà un <!DOCTYPE (= template legacy avec HTML complet, on laisse tel quel).
function wrapInSkeleton(body: string, branding: OrgBranding): string {
  if (!branding.emailSkeleton) return body;
  if (/<!doctype/i.test(body) || /<html[\s>]/i.test(body)) return body;
  return branding.emailSkeleton.replace("{{EMAIL_BODY}}", body);
}

// Substitution placeholders {{KEY}} dans un texte arbitraire (subject ou body)
function applyPlaceholders(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(key).join(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resend send
// ---------------------------------------------------------------------------

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
    if (!res.ok || !data?.id) {
      const msg = data?.message || data?.error?.message || data?.name || `Resend HTTP ${res.status}`;
      return { providerId: null, errorMessage: String(msg).substring(0, 500) };
    }
    return { providerId: data.id, errorMessage: null };
  } catch (err) {
    return {
      providerId: null,
      errorMessage: (err instanceof Error ? err.message : String(err)).substring(0, 500),
    };
  }
}

// ---------------------------------------------------------------------------
// Insert mailing_logs (skip si recipientId NULL → mode test)
// ---------------------------------------------------------------------------

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
  const { error } = await admin
    .schema("majordhome")
    .from("mailing_logs")
    .insert(row);
  if (error) {
    console.error("[mailing-send] mailing_logs insert failed:", error);
  }
}

// ---------------------------------------------------------------------------
// Personalisation HTML
// ---------------------------------------------------------------------------

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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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
  // Placeholders branding/contact (alignés avec contract-signed-notify)
  html = applyPlaceholders(html, params.brandingReplacements);
  // Placeholders dynamiques par destinataire
  html = html.replace(/\{\{SALUTATION\}\}/g, params.salutation);
  html = html.replace(/\{\{lien_pellets\}\}/g, params.lienPellets);
  const escapedEmail = params.contactEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mailtoRegex = new RegExp(`mailto:${escapedEmail}\\?subject=D[eé]sabonnement`, "gi");
  html = html.replace(mailtoRegex, params.unsubscribeUrl);
  return html;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
    // Fetch destinataires via RPC (compile + exec + check membership serverside)
    const fetched = await fetchRecipients({
      mode,
      segmentId,
      clientId,
      campaignName,
      authHeader,
      isServiceRole: auth.isServiceRole,
    });

    let { recipients, orgId, recipientType } = fetched;

    // Cas test : on garde l'org/type du segment ou client, peu importe que la
    // liste réelle soit vide.
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
          recipient_id: "", // sentinel non-uuid → mailing_logs skip
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
        success: true,
        test_mode: false,
        total: 0,
        sent: 0,
        failed: 0,
        note: "Aucun destinataire éligible — segment vide après filtres.",
      });
    }

    // Load branding org
    const branding = await loadOrgBranding(orgId);

    // Boucle d'envoi séquentiel
    let sentCount = 0;
    let failedCount = 0;
    for (const r of recipients) {
      const toEmail = testEmail || r.email;
      if (!toEmail) {
        failedCount++;
        continue;
      }

      const recipientIdForLog = testEmail ? null : r.recipient_id;
      const salutation = buildSalutation(r);
      const lienPellets = buildPelletsLink(r, campaignName, branding);
      const unsubscribeUrl = await buildUnsubscribeUrl(
        recipientType,
        recipientIdForLog,
        `mailto:${branding.contactEmail}?subject=Désabonnement`,
      );
      const listUnsubscribeHeader =
        `<${unsubscribeUrl}>, <mailto:${branding.contactEmail}?subject=Désabonnement>`;

      // Placeholders branding + nom destinataire (aligné avec contract-signed-notify)
      const brandingReplacements = buildRecipientReplacements(r, branding);
      const personalizedSubject = applyPlaceholders(subject, brandingReplacements);

      // Wrap le corps dans le squelette commun (logo + bande couleur + footer) si défini en settings org.
      // Templates legacy (avec <html>/<!DOCTYPE>) sont laissés tels quels.
      const wrappedHtml = wrapInSkeleton(htmlBody, branding);

      const html = personalizeHtml({
        htmlBody: wrappedHtml,
        salutation,
        lienPellets,
        unsubscribeUrl,
        contactEmail: branding.contactEmail,
        brandingReplacements,
      });

      const sendResult = await sendViaResend({
        branding,
        to: toEmail,
        subject: personalizedSubject,
        html,
        listUnsubscribeHeader,
      });

      if (sendResult.providerId) sentCount++;
      else failedCount++;

      await insertMailingLog({
        recipientType,
        recipientId: recipientIdForLog,
        orgId,
        campaignName,
        subject: personalizedSubject,
        emailTo: toEmail,
        result: sendResult,
      });
    }

    return jsonResponse({
      success: true,
      test_mode: !!testEmail,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
    });
  } catch (err) {
    console.error("[mailing-send] error:", err);
    return jsonResponse(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
