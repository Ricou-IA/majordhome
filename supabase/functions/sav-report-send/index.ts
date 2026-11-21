// ============================================================================
// sav-report-send — envoi au client du rapport d'intervention SAV archivé, par e-mail (Resend).
// Spec : docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md
// ============================================================================
//
// verify_jwt:true + requireOrgMembership + module Communication + user_can(sav | entretiens, edit).
// Corps : { org_id, intervention_id }. Rien d'autre n'est lu de la requête :
//   - la carte est relue en base, au jeton de l'utilisateur et dans son organisation ;
//   - le destinataire est l'e-mail du client de la carte (jamais une adresse reçue) ;
//   - le chemin du PDF est DÉRIVÉ (`buildInterventionReportPath`, même fonction que l'écran) ;
//   - le texte vient du gabarit transactionnel `rapport_sav` de l'org (Paramètres → Emails).
//
// Réponse : HTTP 200 `{ data, error }` où `error` est un CODE (src/lib/rapportSav.js::RAPPORT_SAV_CODES,
// traduit par `messageErreurRapportSav`) ; 4xx / 5xx réservés à l'authentification et aux pannes.
// Succès : `{ data: { to, provider_id }, error: null }`. Trace : `mailing_logs` campaign `rapport_sav`.
//
// Secrets : RESEND_API_KEY (SUPABASE_URL / SUPABASE_ANON_KEY / service role fournis par la plateforme).
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml, sanitizeFilename,
  sendResendEmail, insertMailingLog, arrayBufferToBase64,
} from "../_shared/mail.ts";
import { chargerTexteEmail } from "../_shared/texteEmail.ts";
import { buildInterventionReportPath } from "../_shared/interventionStoragePath.js";
import {
  RAPPORT_SAV_EMAIL_TEMPLATE_KEY, peutFaireRapportSav, rapportDeCarte, dateInterventionFr, appareilPourEmail,
} from "../_shared/rapportSav.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const BUCKET = "interventions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Le rapport fait une page : au-delà, ce n'est pas lui (le dossier plafonne à 10 Mo). */
const PDF_MAX_OCTETS = 10 * 1024 * 1024;

interface Carte {
  id: string;
  project_id: string | null;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  intervention_type: string;
  workflow_status: string;
  parent_id: string | null;
  metadata: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const interventionId = typeof body.intervention_id === "string" ? body.intervention_id : "";
  if (!UUID.test(orgId) || !UUID.test(interventionId)) {
    return jsonResponse({ error: "org_id et intervention_id requis" }, 400, req);
  }

  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;

  const ok = (data: unknown) => jsonResponse({ data, error: null }, 200, req);
  const refus = (code: string) => jsonResponse({ data: null, error: code }, 200, req);

  try {
    // Module de l'offre : garde positive, tout sauf `true` ferme.
    const { data: org, error: errOrg } = await auth.supabase.schema("core").from("organizations")
      .select("settings").eq("id", orgId).maybeSingle();
    if (errOrg) return jsonResponse({ error: sanitizeError(errOrg, "lecture de l'organisation impossible") }, 500, req);
    const settings = ((org?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const modules = (settings.modules ?? {}) as Record<string, unknown>;
    if (modules.communication !== true) return refus("module_communication_inactif");

    // Droits au jeton de l'utilisateur : même règle que la fiche SAV (sav.edit OU entretiens.edit).
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let autorise = false;
    for (const resource of ["sav", "entretiens"]) {
      const { data, error } = await user.rpc("user_can", { p_org_id: orgId, p_resource: resource, p_action: "edit" });
      if (!error && data === true) { autorise = true; break; }
    }
    if (autorise !== true) return refus("droit_requis");

    // La carte, relue en base, au jeton de l'utilisateur (RLS) et dans SON organisation (org CORE).
    const { data: ligne, error: errCarte } = await user.from("majordhome_entretien_sav")
      .select("id, project_id, client_id, client_name, client_email, intervention_type, workflow_status, parent_id, metadata")
      .eq("id", interventionId).eq("org_id", orgId).maybeSingle();
    if (errCarte) return jsonResponse({ error: sanitizeError(errCarte, "lecture de la carte impossible") }, 500, req);
    const carte = ligne as Carte | null;
    if (!carte) return refus("carte_introuvable");
    if (!peutFaireRapportSav(carte)) return refus("carte_non_sav");

    const to = (carte.client_email || "").trim();
    if (!to) return refus("client_sans_email");
    const branding = orgBranding(settings);
    if (!branding.fromEmail) return refus("no_from_email");
    if (!RESEND_API_KEY) {
      console.error("[sav-report-send] RESEND_API_KEY absent");
      return refus("resend_failed");
    }

    // Le rapport archivé : sa trace sur la carte, et le fichier au chemin dérivé (jamais reçu).
    const trace = rapportDeCarte(carte);
    if (!trace || !UUID.test(carte.project_id || "")) return refus("rapport_absent");
    const chemin = buildInterventionReportPath({ orgId, projectId: carte.project_id as string, interventionId: carte.id });
    const { data: fichier, error: errFichier } = await auth.supabase.storage.from(BUCKET).download(chemin);
    if (errFichier || !fichier) {
      console.error(`[sav-report-send] rapport absent du dossier : ${errFichier?.message || "vide"}`);
      return refus("rapport_absent");
    }
    const pdf = await fichier.arrayBuffer();
    const entete = new TextDecoder().decode(new Uint8Array(pdf.slice(0, 5)));
    if (entete !== "%PDF-" || pdf.byteLength > PDF_MAX_OCTETS) {
      console.error(`[sav-report-send] rapport invalide (${entete}, ${pdf.byteLength} octets)`);
      return refus("rapport_illisible");
    }

    const lecture = await chargerTexteEmail(auth.supabase, orgId, RAPPORT_SAV_EMAIL_TEMPLATE_KEY);
    if (lecture.erreur) return jsonResponse({ error: sanitizeError(lecture.erreur, "lecture du gabarit") }, 500, req);
    const gabarit = lecture.texte;
    if (!gabarit) return refus("template_missing");

    const contenu = ((trace.contenu ?? {}) as Record<string, unknown>);
    const remplacements: Record<string, string> = {
      ...brandingReplacements(branding),
      "{{CLIENT_NAME}}": carte.client_name || "",
      "{{DATE_INTERVENTION}}": dateInterventionFr(contenu.date),
      "{{APPAREIL}}": appareilPourEmail(contenu.appareil as { libelle?: string; marque?: string; modele?: string } | null),
    };
    const html: Record<string, string> = { ...remplacements };
    for (const cle of ["{{CLIENT_NAME}}", "{{APPAREIL}}", "{{BRAND_NAME}}", "{{ORG_EMAIL}}", "{{ORG_PHONE}}", "{{ORG_ADDRESS}}", "{{ORG_POSTAL_CODE}}", "{{ORG_CITY}}"]) {
      if (cle in html) html[cle] = escapeHtml(html[cle]);
    }
    const subject = applyPlaceholders(gabarit.subject || "", remplacements);
    const corpsHtml = applyPlaceholders(wrapWithSkeleton(branding, gabarit.html_body || ""), html);
    const from = branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail;
    const nomFichier = `Rapport-intervention-${sanitizeFilename(carte.client_name || "client")}.pdf`;

    const resultat = await sendResendEmail(RESEND_API_KEY, {
      from, to: [to], replyTo: branding.replyTo, subject, html: corpsHtml,
      attachments: [{ filename: nomFichier, content: arrayBufferToBase64(pdf) }],
    });
    const avertissement = await insertMailingLog(auth.supabase, {
      client_id: carte.client_id || null, org_id: orgId, campaign_name: RAPPORT_SAV_EMAIL_TEMPLATE_KEY, subject, email_to: to,
      status: resultat.ok ? "sent" : "failed", provider_id: resultat.id, error_message: resultat.message,
    });
    if (avertissement) console.error(`[sav-report-send] mailing_logs : ${avertissement}`);
    if (!resultat.ok) {
      console.error(`[sav-report-send] Resend a refusé l'envoi : ${resultat.status} ${resultat.message}`);
      return refus("resend_failed");
    }
    return ok({ to, provider_id: resultat.id });
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "erreur interne") }, 500, req);
  }
});
