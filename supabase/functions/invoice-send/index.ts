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
//      (`to` du body ou `client_email`) + `invoice_id`.
//   4. Facture :
//      - `invoice_id` au format uuid → hub (`majordhome_invoices` +
//        bucket `invoices`, `status='issued'` + `pdf_path` requis).
//      - sinon → miroir Pennylane (`majordhome_pennylane_sync`,
//        entity_type='invoice', local_id=intervention_id) ; brouillon PL
//        (`metadata.draft===true`) refusé, PDF distant obligatoire.
//   5. Certificats cochés (`certificate_ids`) : doivent appartenir à
//      l'intervention ou à ses enfants (`majordhome_interventions.parent_id`),
//      PDF archivé obligatoire (bucket `certificats`).
//   6. Plafond 35 Mo cumulés (marge sous la limite Resend 40 Mo).
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
// RESEND_API_KEY.
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
  sanitizeFilename,
  arrayBufferToBase64,
  sendResendEmail,
  insertMailingLog,
} from "../_shared/mail.ts";
import type { ResendAttachment } from "../_shared/mail.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const MAX_ATTACHMENTS_BYTES = 35 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  org_id?: string;
  intervention_id?: string;
  certificate_ids?: string[];
  to?: string;
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

    const to = (body.to || card.client_email || "").trim();
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
      const metadata = (sync.metadata as Record<string, unknown> | null) ?? {};
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
      invoiceNumber = (sync.pennylane_number as string | null) || invoiceNumber;
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
        const label = cert.reference || cert.equipement_type || cert.id;
        const filename = `Certificat_${sanitizeFilename(String(label))}.pdf`;
        attachments.push({ filename, content: arrayBufferToBase64(buf) });
        attachmentNames.push(filename);
        const equipLabel = [cert.equipement_type, cert.equipement_marque, cert.equipement_modele]
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

    // 6) Placeholders (marque + facture + certificats).
    const replacements: Record<string, string> = {
      ...brandingReplacements(branding),
      "{{CLIENT_NAME}}": card.client_name || "",
      "{{INVOICE_NUMBER}}": invoiceNumber,
      "{{INVOICE_AMOUNT}}": formatAmount(invoiceAmount),
      "{{INVOICE_DATE}}": formatDateFR(invoiceDateRaw),
      "{{EQUIPMENTS}}": equipmentLabels.length > 0 ? equipmentLabels.join(", ") : "vos équipements",
      "{{ATTACHMENTS}}": attachmentNames.join(", "),
    };

    const subject = applyPlaceholders(template.subject || "", replacements);
    const html = applyPlaceholders(wrapWithSkeleton(branding, template.html_body || ""), replacements);

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
