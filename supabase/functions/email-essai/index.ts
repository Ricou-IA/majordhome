// ============================================================================
// email-essai — « M'envoyer un essai » d'un e-mail automatique (Réglages → Emails)
// ============================================================================
// L'entreprise reçoit, à SON adresse de réponse (réglages), l'e-mail tel qu'il partira
// chez un client : texte de l'entreprise s'il existe, sinon texte par défaut,
// habillé du squelette et des couleurs de l'entreprise, avec les valeurs
// d'exemple du registre (`emailsAutomatiques.js`). Aucune pièce jointe.
//
// Sécurité :
//   - verify_jwt:true + requireOrgMembership(org_admin) + module Communication.
//   - Le destinataire n'est JAMAIS reçu : c'est l'adresse de réponse de l'entreprise, relue en base
//     (l'adresse d'un compte peut n'être qu'un identifiant sans boîte, Eric 2026-11-21).
//   - La clé doit être au registre (e-mail automatique ou séquence) : pas de texte arbitraire, pas d'autre clé
//     de `mail_campaigns`.
//   - Rien n'est écrit en base (ni mailing_logs : ce n'est pas un envoi client).
//
// Body : { org_id, cle }. Réponse HTTP 200 `{ data, error }` où `error` est un
// CODE de `ESSAI_CODES` (et `detail` la précision du service d'envoi).
//
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via _shared/auth), RESEND_API_KEY.
// ============================================================================

import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, sendResendEmail,
} from "../_shared/mail.ts";
import { chargerTexteEmail } from "../_shared/texteEmail.ts";
import { emailOuSequence } from "../_shared/emailsAutomatiques.js";
import { moduleActif } from "../_shared/modules.js";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  if (!RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500, req);

  let body: { org_id?: string; cle?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, req);
  }

  const auth = await requireOrgMembership(req, { orgId: body.org_id, requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const { orgId, supabase } = auth;

  const refus = (code: string, detail: string | null = null) => jsonResponse({ data: null, error: code, detail }, 200, req);

  try {
    const entree = emailOuSequence(String(body.cle || "").trim());
    if (!entree) return refus("email_inconnu");
    const cle = entree.gabarit.key;

    const { data: org, error: orgErr } = await supabase
      .schema("core").from("organizations").select("settings").eq("id", orgId).single();
    if (orgErr || !org) return jsonResponse({ error: sanitizeError(orgErr, "organisation illisible") }, 500, req);
    const settings = (org.settings as Record<string, unknown> | null) ?? {};
    if (!moduleActif(settings, "communication")) return refus("module_communication_inactif");

    const branding = orgBranding(settings);
    if (!branding.fromEmail) return refus("no_from_email");

    const destinataire = String(branding.replyTo || "").trim();
    if (!destinataire.includes("@")) return refus("destinataire_inconnu");

    const lecture = await chargerTexteEmail(supabase, orgId, cle);
    if (lecture.erreur || !lecture.texte) return refus("texte_illisible");

    const valeurs = { ...brandingReplacements(branding), ...entree.exemple };
    const subject = `[Essai] ${applyPlaceholders(lecture.texte.subject, valeurs)}`;
    const html = applyPlaceholders(wrapWithSkeleton(branding, lecture.texte.html_body), valeurs);

    const envoi = await sendResendEmail(RESEND_API_KEY, {
      from: branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail,
      to: [destinataire],
      replyTo: branding.replyTo || undefined,
      subject,
      html,
    });
    if (!envoi.ok) return refus("envoi_refuse", envoi.message);

    return jsonResponse({ data: { envoye_a: destinataire, source: lecture.texte.source }, error: null }, 200, req);
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "email-essai failed") }, 500, req);
  }
});
