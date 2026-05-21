// ============================================================================
// contract-signed-notify — Email de confirmation après signature contrat
// ============================================================================
//
// Remplace le workflow N8N "Mayer - Entretien Contrat" par une edge function
// multi-tenant. Reçoit { contract_id }, charge tout depuis la DB (contract,
// org settings, template), récupère le PDF depuis storage, envoie via Resend
// avec le PDF en pièce jointe, log dans mailing_logs.
//
// Architecture :
//   1. JWT user obligatoire (verify_jwt: true)
//   2. Lecture contract via JWT user → RLS valide la membership org
//   3. Settings org depuis core.organizations.settings (brand_name, from_email,
//      phone, address, accent_color, etc.)
//   4. Template HTML depuis majordhome.mail_campaigns (key=contrat_signature_confirm)
//      avec placeholders {{CLIENT_NAME}}, {{BRAND_NAME}}, {{ORG_*}}, {{ACCENT_COLOR}}
//   5. PDF téléchargé via storage.download() (RLS storage applique)
//   6. Envoi Resend avec pièce jointe base64
//   7. INSERT mailing_logs (status=sent|failed, provider_id, error_message)
//
// Env requis :
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - RESEND_API_KEY
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function applyPlaceholders(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }
  return out;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9À-ÿ_\-]/g, "_").replace(/_+/g, "_");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Authorization header manquant" }, 401);
    }

    let payload: { contract_id?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "JSON invalide" }, 400);
    }

    const contractId = payload.contract_id?.trim();
    if (!contractId) {
      return json({ error: "contract_id requis" }, 400);
    }

    // Client supabase avec le JWT user — RLS s'applique pour tous les SELECT
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Charger contrat + client + org_id (RLS valide membership)
    const { data: contract, error: contractErr } = await supabase
      .from("majordhome_contracts")
      .select("id, org_id, client_id, client_name, client_email, contract_pdf_path, amount")
      .eq("id", contractId)
      .single();

    if (contractErr || !contract) {
      return json(
        { error: "Contrat introuvable ou accès refusé", details: contractErr?.message },
        404,
      );
    }

    if (!contract.client_email) {
      return json({ error: "Email client manquant sur le contrat" }, 400);
    }
    if (!contract.contract_pdf_path) {
      return json({ error: "PDF contrat non encore généré (contract_pdf_path null)" }, 400);
    }

    // 2) Settings org depuis core.organizations
    const { data: org, error: orgErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("id, name, settings")
      .eq("id", contract.org_id)
      .single();

    if (orgErr || !org) {
      return json(
        { error: "Organisation introuvable", details: orgErr?.message },
        404,
      );
    }

    const settings = (org.settings as Record<string, string | null> | null) || {};
    const brandName = settings.brand_name || org.name;
    const fromEmail = settings.from_email;
    const fromName = settings.from_name || brandName;
    const replyTo = settings.reply_to || fromEmail;
    const accentColor = settings.accent_color || "#f97316";

    if (!fromEmail) {
      return json(
        { error: "Settings org incomplets : from_email manquant. Configurer core.organizations.settings." },
        500,
      );
    }

    // 3) Template depuis mail_campaigns
    const { data: template, error: tmplErr } = await supabase
      .from("majordhome_mail_campaigns")
      .select("subject, html_body")
      .eq("org_id", contract.org_id)
      .eq("key", "contrat_signature_confirm")
      .single();

    if (tmplErr || !template) {
      return json(
        {
          error: "Template 'contrat_signature_confirm' introuvable dans mail_campaigns",
          details: tmplErr?.message,
        },
        500,
      );
    }

    // 4) Télécharger le PDF depuis storage (RLS storage applique le filtre org)
    const { data: pdfBlob, error: pdfErr } = await supabase.storage
      .from("contracts")
      .download(contract.contract_pdf_path);

    if (pdfErr || !pdfBlob) {
      return json(
        { error: "Impossible de télécharger le PDF du contrat", details: pdfErr?.message },
        500,
      );
    }

    const pdfBuffer = await pdfBlob.arrayBuffer();
    const pdfBase64 = arrayBufferToBase64(pdfBuffer);

    // 5) Remplacement placeholders
    const replacements: Record<string, string> = {
      "{{CLIENT_NAME}}": contract.client_name || "cher client",
      "{{BRAND_NAME}}": brandName ?? "",
      "{{ORG_EMAIL}}": fromEmail,
      "{{ORG_PHONE}}": settings.phone || "",
      "{{ORG_ADDRESS}}": settings.address || "",
      "{{ORG_POSTAL_CODE}}": settings.postal_code || "",
      "{{ORG_CITY}}": settings.city || "",
      "{{ACCENT_COLOR}}": accentColor,
    };

    const subject = applyPlaceholders(template.subject || "", replacements);
    const htmlBody = applyPlaceholders(template.html_body || "", replacements);

    // 6) Envoi via Resend
    const resendPayload = {
      from: `${fromName} <${fromEmail}>`,
      to: [contract.client_email],
      reply_to: replyTo,
      subject,
      html: htmlBody,
      attachments: [
        {
          filename: `Contrat_${sanitizeFilename(brandName || "Entretien")}.pdf`,
          content: pdfBase64,
        },
      ],
    };

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    let resendData: { id?: string; message?: string } = {};
    try {
      resendData = await resendResp.json();
    } catch {
      // Resend a renvoyé du non-JSON (timeout, etc.)
    }

    const logStatus = resendResp.ok ? "sent" : "failed";
    const errorMessage = resendResp.ok
      ? null
      : (resendData.message || `Resend HTTP ${resendResp.status}`);

    // 7) Log dans mailing_logs (best-effort, on n'échoue pas la réponse si le log échoue)
    const { error: logErr } = await supabase
      .from("majordhome_mailing_logs")
      .insert({
        client_id: contract.client_id,
        org_id: contract.org_id,
        campaign_name: "contrat_signature_confirm",
        subject,
        email_to: contract.client_email,
        status: logStatus,
        provider_id: resendData.id || null,
        error_message: errorMessage,
      });
    if (logErr) {
      console.warn("[contract-signed-notify] mailing_logs insert failed:", logErr);
    }

    if (!resendResp.ok) {
      return json({ success: false, error: errorMessage }, 502);
    }

    return json({
      success: true,
      provider_id: resendData.id,
      sent_to: contract.client_email,
    });
  } catch (err) {
    console.error("[contract-signed-notify]", err);
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
