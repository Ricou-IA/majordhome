// ============================================================================
// invoice-send — Envoi de la facture d'entretien (+ certificats) au client par
// e-mail via Resend, gate module Communication (spec
// docs/superpowers/specs/2026-09-23-facture-entretien-envoi-email-resend-design.md)
// ============================================================================
//
//   1. Auth JWT user + membership team_leader+ + module Communication actif
//      (`settings.modules.communication === true`, orgSettingsFilter). Un
//      échec 403 de `requireOrgMembership` (rôle insuffisant OU module
//      fermé) est reporté comme `module_communication_inactif` — la coche
//      d'envoi n'existe pas côté front tant que le module n'est pas ouvert,
//      donc un 403 ici pointe presque toujours ce cas.
//   2. Branding org (`_shared/mail.ts::orgBranding`) — `fromEmail` vide ⇒
//      409 `no_from_email` (pas de fallback Mayer).
//   3. Carte entretien (`majordhome_entretien_sav`, org CORE) → destinataire
//      (`client_email` uniquement, jamais d'override via le body) + `invoice_id`.
//   4. Facture :
//      - `invoice_id` au format uuid → hub (`majordhome_invoices` +
//        bucket `invoices`, `status='issued'` + `pdf_path` requis).
//      - sinon → miroir Pennylane (`majordhome_pennylane_sync`,
//        entity_type='invoice', local_id=intervention_id). Le miroir n'est
//        rafraîchi qu'une fois à la création (`draft`/`public_file_url`/
//        `file_url` jamais réécrits depuis) : si `metadata.draft===true` OU
//        qu'aucune URL de PDF n'est connue, un GET Pennylane ciblé
//        (`/customer_invoices/{id}`) rafraîchit le miroir AVANT de refuser —
//        une facture créée brouillon puis finalisée dans Pennylane doit
//        pouvoir être envoyée sans repasser par un cron. Brouillon confirmé
//        après rafraîchissement refusé, PDF distant obligatoire.
//   5. Certificats cochés (`certificate_ids`) : doivent appartenir à
//      l'intervention ou à ses enfants (`majordhome_interventions.parent_id`),
//      PDF archivé obligatoire (bucket `certificats`).
//   6. Plafond 29 Mo cumulés BRUTS (Resend limite à 40 Mo APRÈS encodage
//      base64, ×4/3 la taille brute).
//   7. Gabarit `mail_campaigns` clé `facture_entretien` (non archivé).
//   8. Envoi Resend + log `majordhome_mailing_logs` (best-effort, jamais
//      bloquant) dans les deux issues (sent/failed) — l'échec du log est
//      journalisé et renvoyé en `log_warning`, jamais en erreur bloquante.
//
// Codes d'erreur (corps `{ error: code, detail? }`) :
//   module_communication_inactif (403), no_from_email (409),
//   intervention_not_found (404), client_email_missing (409),
//   invoice_missing (409), invoice_is_draft (409), invoice_pdf_missing (409),
//   certificate_not_allowed (409), certificate_pdf_missing (409),
//   attachments_too_large (413), template_missing (409), resend_failed (502).
//
// Succès (201) : { ok: true, provider_id, to, attachments: string[], log_warning? }
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via `_shared/auth.ts`),
// RESEND_API_KEY. PENNYLANE_API_TOKEN / PENNYLANE_BASE_URL optionnels — sans
// token, le rafraîchissement du miroir Pennylane (I1) est sauté, repli sur les
// métadonnées déjà en base.
// ============================================================================
import {
  requireOrgMembership,
  jsonResponse,
  buildCorsHeaders,
  sanitizeError,
} from "../_shared/auth.ts";
import {
  orgBranding,
  brandingReplacements,
  wrapWithSkeleton,
  applyPlaceholders,
  escapeHtml,
  sanitizeFilename,
  arrayBufferToBase64,
  sendResendEmail,
  insertMailingLog,
} from "../_shared/mail.ts";
import type { ResendAttachment } from "../_shared/mail.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL = Deno.env.get("PENNYLANE_BASE_URL") || "https://app.pennylane.com/api/external/v2";
// Resend limite les pièces jointes à 40 Mo APRÈS encodage base64 (×4/3 la taille
// brute) : plafonner le cumul BRUT à 29 Mo laisse la marge nécessaire pour ne
// jamais dépasser la limite réelle une fois encodé (29 × 4/3 ≈ 38,7 Mo).
const MAX_ATTACHMENTS_BYTES = 29 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  org_id?: string;
  intervention_id?: string;
  certificate_ids?: string[];
}

/**
 * I1 — rafraîchit `majordhome_pennylane_sync.metadata` (posé une seule fois à
 * la création, jamais réécrit depuis) avant de décider qu'une facture est un
 * brouillon ou sans PDF. GET ciblé `/customer_invoices/{id}` (réponse = objet
 * facture à la RACINE, même style que `pennylane-invoice-import`). Sans
 * `PENNYLANE_API_TOKEN`, ou si le miroir n'a pas besoin d'être rafraîchi,
 * renvoie les métadonnées telles quelles sans appel réseau.
 */
async function refreshPennylaneInvoiceMirror(
  supabase: SupabaseClient,
  orgId: string,
  interventionId: string,
  sync: { pennylane_id: number | string; pennylane_number: string | null; metadata: Record<string, unknown> | null },
): Promise<{ metadata: Record<string, unknown>; pennylaneNumber: string | null; error?: string }> {
  const metadata = sync.metadata ?? {};
  const pennylaneNumber = sync.pennylane_number;
  const needsRefresh = metadata.draft === true || (!metadata.public_file_url && !metadata.file_url);
  if (!needsRefresh || !PENNYLANE_API_TOKEN) return { metadata, pennylaneNumber };

  let res: Response;
  try {
    res = await fetch(`${PENNYLANE_BASE_URL}/customer_invoices/${sync.pennylane_id}`, {
      headers: { Authorization: `Bearer ${PENNYLANE_API_TOKEN}`, Accept: "application/json" },
    });
  } catch (err) {
    return { metadata, pennylaneNumber, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) return { metadata, pennylaneNumber, error: `Pennylane HTTP ${res.status}` };

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return { metadata, pennylaneNumber, error: "Pennylane HTTP invalid_json" };
  }

  const draft = data.draft === true || data.status === "draft";
  const publicFileUrl = (data.public_file_url as string | null | undefined) ?? metadata.public_file_url;
  const fileUrl = (data.file_url as string | null | undefined) ?? metadata.file_url;
  const invoiceNumber = (data.invoice_number as string | null | undefined) || sync.pennylane_number;
  const nextMetadata = {
    ...metadata,
    draft,
    public_file_url: publicFileUrl,
    file_url: fileUrl,
    refreshed_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from("majordhome_pennylane_sync")
    .update({ pennylane_number: invoiceNumber, metadata: nextMetadata, last_synced_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("entity_type", "invoice")
    .eq("local_id", interventionId);
  if (updErr) {
    console.warn("[invoice-send] pennylane_sync refresh update failed:", updErr.message);
  }
  // Le numéro relu chez Pennylane (attribué à la finalisation) doit servir à l'e-mail
  // de CE même appel — pas la valeur pré-rafraîchissement du miroir (re-revue 2026-09-24).
  return { metadata: nextMetadata, pennylaneNumber: invoiceNumber ?? null };
}

/** `metadata.date` / `invoice_date` → dd/mm/yyyy. Valeur non parsable renvoyée telle quelle. */
function formatDateFR(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `${n.toFixed(2).replace(".", ",")} €`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Corps JSON invalide" }, 400, req);
  }
  if (!body.org_id || !body.intervention_id) {
    return jsonResponse({ error: "org_id et intervention_id sont requis" }, 400, req);
  }

  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    requiredRole: "team_leader",
    orgSettingsFilter: (s) =>
      (s.modules as { communication?: boolean } | undefined)?.communication === true,
  });
  if (!auth.ok) {
    if (auth.response.status === 403) {
      return jsonResponse({ error: "module_communication_inactif" }, 403, req);
    }
    return auth.response;
  }
  if (!RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY manquant" }, 500, req);

  const { supabase, orgId } = auth;
  const interventionId = body.intervention_id;
  const certificateIds = Array.isArray(body.certificate_ids)
    ? body.certificate_ids.filter((id): id is string => Boolean(id))
    : [];

  try {
    // 1) Branding org — settings.from_email/reply_to, jamais de fallback Mayer.
    const { data: org, error: orgErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    if (orgErr) return jsonResponse({ error: sanitizeError(orgErr, "lecture organisation") }, 500, req);
    const branding = orgBranding((org?.settings as Record<string, unknown> | null) ?? {});
    if (!branding.fromEmail) return jsonResponse({ error: "no_from_email" }, 409, req);

    // 2) Carte entretien — `majordhome_entretien_sav.org_id` porte l'org CORE.
    const { data: card, error: cardErr } = await supabase
      .from("majordhome_entretien_sav")
      .select("id, org_id, client_id, client_name, client_email, contract_number, invoice_id, invoiced_at")
      .eq("id", interventionId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (cardErr) return jsonResponse({ error: sanitizeError(cardErr, "lecture intervention") }, 500, req);
    if (!card) return jsonResponse({ error: "intervention_not_found" }, 404, req);

    const to = (card.client_email || "").trim();
    if (!to) return jsonResponse({ error: "client_email_missing" }, 409, req);
    if (!card.invoice_id) return jsonResponse({ error: "invoice_missing" }, 409, req);

    // 3) Facture — hub (uuid) ou miroir Pennylane (sinon).
    let invoiceNumber = "sans numéro";
    let invoiceAmount: unknown = null;
    let invoiceDateRaw: unknown = null;
    let invoicePdfBuffer: ArrayBuffer | null = null;

    if (UUID_RE.test(String(card.invoice_id))) {
      const { data: invoice, error: invErr } = await supabase
        .from("majordhome_invoices")
        .select("id, number, invoice_date, total_ttc, pdf_path, status")
        .eq("id", card.invoice_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (invErr) return jsonResponse({ error: sanitizeError(invErr, "lecture facture") }, 500, req);
      if (!invoice) return jsonResponse({ error: "invoice_missing" }, 409, req);
      if (invoice.status !== "issued" || !invoice.pdf_path) {
        return jsonResponse({ error: "invoice_pdf_missing" }, 409, req);
      }
      const { data: pdfBlob, error: pdfErr } = await supabase.storage
        .from("invoices")
        .download(invoice.pdf_path);
      if (pdfErr || !pdfBlob) {
        return jsonResponse({ error: "invoice_pdf_missing", detail: pdfErr?.message }, 409, req);
      }
      invoiceNumber = invoice.number || invoiceNumber;
      invoiceAmount = invoice.total_ttc;
      invoiceDateRaw = invoice.invoice_date;
      invoicePdfBuffer = await pdfBlob.arrayBuffer();
    } else {
      const { data: sync, error: syncErr } = await supabase
        .from("majordhome_pennylane_sync")
        .select("pennylane_id, pennylane_number, metadata")
        .eq("org_id", orgId)
        .eq("entity_type", "invoice")
        .eq("local_id", interventionId)
        .maybeSingle();
      if (syncErr) return jsonResponse({ error: sanitizeError(syncErr, "lecture facture Pennylane") }, 500, req);
      if (!sync) return jsonResponse({ error: "invoice_missing" }, 409, req);

      const refreshed = await refreshPennylaneInvoiceMirror(supabase, orgId, interventionId, sync);
      if (refreshed.error) {
        return jsonResponse({ error: "invoice_pdf_missing", detail: refreshed.error }, 409, req);
      }
      const metadata = refreshed.metadata;
      if (metadata.draft === true) return jsonResponse({ error: "invoice_is_draft" }, 409, req);
      const url = (metadata.public_file_url as string | undefined) || (metadata.file_url as string | undefined);
      if (!url) return jsonResponse({ error: "invoice_pdf_missing" }, 409, req);
      let pdfRes: Response;
      try {
        pdfRes = await fetch(url);
      } catch (err) {
        return jsonResponse(
          { error: "invoice_pdf_missing", detail: err instanceof Error ? err.message : String(err) },
          409,
          req,
        );
      }
      if (!pdfRes.ok) {
        return jsonResponse({ error: "invoice_pdf_missing", detail: `HTTP ${pdfRes.status}` }, 409, req);
      }
      invoiceNumber = refreshed.pennylaneNumber || (sync.pennylane_number as string | null) || invoiceNumber;
      invoiceAmount = metadata.amount;
      invoiceDateRaw = metadata.date;
      invoicePdfBuffer = await pdfRes.arrayBuffer();
    }

    if (!invoicePdfBuffer) return jsonResponse({ error: "invoice_pdf_missing" }, 409, req);

    // 4) Pièces jointes — facture d'abord, puis certificats cochés.
    const attachments: ResendAttachment[] = [];
    const attachmentNames: string[] = [];
    const equipmentLabels: string[] = [];
    let totalBytes = invoicePdfBuffer.byteLength;

    const invoiceFilename = `Facture_${sanitizeFilename(invoiceNumber)}.pdf`;
    attachments.push({ filename: invoiceFilename, content: arrayBufferToBase64(invoicePdfBuffer) });
    attachmentNames.push(invoiceFilename);

    if (certificateIds.length > 0) {
      const { data: children, error: childrenErr } = await supabase
        .from("majordhome_interventions")
        .select("id")
        .eq("parent_id", interventionId);
      if (childrenErr) {
        return jsonResponse({ error: sanitizeError(childrenErr, "lecture interventions enfants") }, 500, req);
      }
      const allowedInterventionIds = new Set<string>([
        interventionId,
        ...((children || []) as Array<{ id: string }>).map((c) => c.id),
      ]);

      const { data: certificats, error: certErr } = await supabase
        .from("majordhome_certificats")
        .select("id, intervention_id, reference, equipement_type, equipement_marque, equipement_modele, pdf_storage_path")
        .eq("org_id", orgId)
        .in("id", certificateIds);
      if (certErr) return jsonResponse({ error: sanitizeError(certErr, "lecture certificats") }, 500, req);

      // I2 — `equipement_type` est un CODE de catégorie (ex. `pac_air_air`), jamais un libellé
      // client-friendly : résolu via le référentiel de l'org avant tout usage destiné au client
      // ({{EQUIPMENTS}} du gabarit + libellé de fichier certificat).
      const { data: categories, error: catErr } = await supabase
        .from("majordhome_equipment_categories")
        .select("code, label")
        .eq("org_id", orgId);
      if (catErr) return jsonResponse({ error: sanitizeError(catErr, "lecture catégories équipement") }, 500, req);
      const labelByCode = new Map((categories || []).map((c) => [c.code as string, c.label as string]));

      const byId = new Map((certificats || []).map((c) => [c.id as string, c]));
      for (const id of certificateIds) {
        const cert = byId.get(id);
        if (!cert || !allowedInterventionIds.has(cert.intervention_id)) {
          return jsonResponse({ error: "certificate_not_allowed", detail: id }, 409, req);
        }
        if (!cert.pdf_storage_path) {
          return jsonResponse({ error: "certificate_pdf_missing", detail: cert.reference || cert.id }, 409, req);
        }
        const { data: certBlob, error: certDlErr } = await supabase.storage
          .from("certificats")
          .download(cert.pdf_storage_path);
        if (certDlErr || !certBlob) {
          return jsonResponse({ error: "certificate_pdf_missing", detail: cert.reference || cert.id }, 409, req);
        }
        const buf = await certBlob.arrayBuffer();
        totalBytes += buf.byteLength;
        const equipmentLabel = cert.equipement_type
          ? (labelByCode.get(cert.equipement_type as string) || (cert.equipement_type as string))
          : null;
        const label = cert.reference || equipmentLabel || cert.id;
        const filename = `Certificat_${sanitizeFilename(String(label))}.pdf`;
        attachments.push({ filename, content: arrayBufferToBase64(buf) });
        attachmentNames.push(filename);
        const equipLabel = [equipmentLabel, cert.equipement_marque, cert.equipement_modele]
          .filter(Boolean)
          .join(" ");
        if (equipLabel) equipmentLabels.push(equipLabel);
      }
    }

    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      return jsonResponse({ error: "attachments_too_large" }, 413, req);
    }

    // 5) Gabarit — campagne `facture_entretien`, non archivée.
    const { data: template, error: tmplErr } = await supabase
      .from("majordhome_mail_campaigns")
      .select("subject, html_body")
      .eq("org_id", orgId)
      .eq("key", "facture_entretien")
      .eq("is_archived", false)
      .maybeSingle();
    if (tmplErr) return jsonResponse({ error: sanitizeError(tmplErr, "lecture gabarit") }, 500, req);
    if (!template) return jsonResponse({ error: "template_missing" }, 409, req);

    // 6) Placeholders (marque + facture + certificats). Le sujet garde des valeurs brutes
    // (texte simple, pas de rendu HTML) ; le corps HTML échappe les champs texte qui peuvent
    // contenir du contenu utilisateur (M3) — jamais les URLs/couleurs de branding, qui doivent
    // rester utilisables telles quelles dans un `href`/`src`/style inline.
    const replacements: Record<string, string> = {
      ...brandingReplacements(branding),
      "{{CLIENT_NAME}}": card.client_name || "",
      "{{INVOICE_NUMBER}}": invoiceNumber,
      "{{INVOICE_AMOUNT}}": formatAmount(invoiceAmount),
      "{{INVOICE_DATE}}": formatDateFR(invoiceDateRaw),
      "{{EQUIPMENTS}}": equipmentLabels.length > 0 ? equipmentLabels.join(", ") : "vos équipements",
      "{{ATTACHMENTS}}": attachmentNames.join(", "),
    };
    const ESCAPED_HTML_KEYS = [
      "{{CLIENT_NAME}}", "{{INVOICE_NUMBER}}", "{{EQUIPMENTS}}", "{{ATTACHMENTS}}",
      "{{BRAND_NAME}}", "{{ORG_EMAIL}}", "{{ORG_PHONE}}", "{{ORG_ADDRESS}}", "{{ORG_POSTAL_CODE}}", "{{ORG_CITY}}",
    ];
    const htmlReplacements: Record<string, string> = { ...replacements };
    for (const key of ESCAPED_HTML_KEYS) {
      if (key in htmlReplacements) htmlReplacements[key] = escapeHtml(htmlReplacements[key]);
    }

    const subject = applyPlaceholders(template.subject || "", replacements);
    const html = applyPlaceholders(wrapWithSkeleton(branding, template.html_body || ""), htmlReplacements);

    // 7) Envoi Resend + log mailing_logs (best-effort, jamais bloquant).
    const fromHeader = branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail;
    const result = await sendResendEmail(RESEND_API_KEY, {
      from: fromHeader,
      to: [to],
      replyTo: branding.replyTo,
      subject,
      html,
      attachments,
    });

    const logWarning = await insertMailingLog(supabase, {
      client_id: card.client_id || null,
      org_id: orgId,
      campaign_name: "facture_entretien",
      subject,
      email_to: to,
      status: result.ok ? "sent" : "failed",
      provider_id: result.id,
      error_message: result.message,
    });
    if (logWarning) {
      console.error("[invoice-send] mailing_logs insert failed:", logWarning);
    }

    if (!result.ok) {
      return jsonResponse({ error: "resend_failed", detail: result.message }, 502, req);
    }

    return jsonResponse(
      {
        ok: true,
        provider_id: result.id,
        to,
        attachments: attachmentNames,
        ...(logWarning ? { log_warning: logWarning } : {}),
      },
      201,
      req,
    );
  } catch (err) {
    console.error("[invoice-send]", err);
    return jsonResponse({ error: sanitizeError(err, "Internal error") }, 500, req);
  }
});
