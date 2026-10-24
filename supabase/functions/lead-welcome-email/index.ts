// supabase/functions/lead-welcome-email/index.ts
// ============================================================================
// lead-welcome-email — e-mail d'accueil des leads Meta Ads (2026-10-24)
// ============================================================================
// verify_jwt:false + MDH_CRON_SECRET (pg_cron toutes les 5 min, migration
// 20261024_4). Pour chaque org où settings.lead_welcome_email.enabled = true
// (et le module Communication ouvert) : leads `external_source = meta_ads`
// créés depuis l'activation (et depuis moins de 72 h), un e-mail par lead
// (gabarit `accueil_lead_meta` de mail_campaigns), tracé dans mailing_logs.
//
// Anti-doublon = mailing_logs (campaign_name = clé du gabarit, lead_id) : un
// lead avec une ligne non `failed` n'est jamais renvoyé ; un échec Resend est
// retenté au passage suivant, au plus LEAD_WELCOME_MAX_ECHECS fois.
// Gabarit absent ou expéditeur non configuré → org sautée et signalée, rien
// n'est envoyé. Options : { dry_run, org_id }.
// Les leads du site vitrine ne passent pas ici (le site envoie sa confirmation).
// ============================================================================

import { requireSharedSecret, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml, sendResendEmail, insertMailingLog,
} from "../_shared/mail.ts";
import { moduleActif } from "../_shared/modules.js";
import { capitaliserPrenom } from "../_shared/smsCampaigns.js";
import {
  LEAD_WELCOME_TEMPLATE_KEY, LEAD_WELCOME_SOURCES, leadWelcomeSettings, borneCreation, leadsAAccueillir,
} from "../_shared/leadWelcomeEmail.js";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

interface OrgReport {
  org_id: string;
  name: string | null;
  skipped?: string;
  error?: string;
  candidats?: number;
  envoyes?: number;
  echecs?: number;
  exclus?: Record<string, number>;
}

type Lead = { id: string; email: string | null; first_name: string | null; last_name: string | null; is_deleted: boolean; email_unsubscribed_at: string | null };

async function traiterOrg(
  admin: ReturnType<typeof getAdminClient>,
  org: { id: string; settings: Record<string, unknown> },
  dryRun: boolean,
  report: OrgReport,
) {
  const reglage = leadWelcomeSettings(org.settings);
  const depuis = borneCreation(reglage.enabled_since!);

  const { data: leads, error: lErr } = await admin.from("majordhome_leads")
    .select("id, email, first_name, last_name, is_deleted, email_unsubscribed_at")
    .eq("org_id", org.id).in("external_source", [...LEAD_WELCOME_SOURCES]).gte("created_at", depuis)
    .order("created_at").limit(500);
  if (lErr) { report.error = sanitizeError(lErr, "leads illisibles"); return; }
  report.candidats = leads?.length ?? 0;
  if (!leads?.length) return;

  const { data: journal, error: jErr } = await admin.from("majordhome_mailing_logs")
    .select("lead_id, status")
    .eq("org_id", org.id).eq("campaign_name", LEAD_WELCOME_TEMPLATE_KEY).in("lead_id", leads.map((l) => l.id));
  // Journal illisible = on ne sait pas qui a déjà reçu : on s'abstient (sinon tout repart).
  if (jErr) { report.error = sanitizeError(jErr, "journal d'envoi illisible"); return; }

  const { aEnvoyer, exclus } = leadsAAccueillir(leads as Lead[], (journal ?? []) as Array<{ lead_id: string | null; status: string }>);
  report.exclus = exclus;
  report.envoyes = 0;
  report.echecs = 0;
  if (!aEnvoyer.length || dryRun) { if (dryRun) report.envoyes = aEnvoyer.length; return; }

  const { data: tpl, error: tErr } = await admin.from("majordhome_mail_campaigns").select("subject, html_body")
    .eq("org_id", org.id).eq("key", LEAD_WELCOME_TEMPLATE_KEY).eq("is_archived", false).maybeSingle();
  if (tErr) { report.error = sanitizeError(tErr, "gabarit illisible"); return; }
  if (!tpl) { report.skipped = "template_missing"; return; }
  const b = orgBranding(org.settings);
  if (!b.fromEmail) { report.skipped = "from_email_manquant"; return; }

  for (const lead of aEnvoyer as Lead[]) {
    const email = String(lead.email).trim();
    const valeurs: Record<string, string> = {
      "{{PRENOM}}": capitaliserPrenom(lead.first_name || "") || "",
      "{{NOM}}": lead.last_name || "",
    };
    const html = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, escapeHtml(v)]));
    const subject = applyPlaceholders(String(tpl.subject || ""), { ...brandingReplacements(b), ...valeurs });
    const body = applyPlaceholders(wrapWithSkeleton(b, String(tpl.html_body || "")), { ...brandingReplacements(b), ...html });
    const res = await sendResendEmail(RESEND_API_KEY, {
      from: b.fromName ? `${b.fromName} <${b.fromEmail}>` : b.fromEmail, to: [email], replyTo: b.replyTo || undefined, subject, html: body,
    });
    const logErr = await insertMailingLog(admin, {
      lead_id: lead.id, org_id: org.id, campaign_name: LEAD_WELCOME_TEMPLATE_KEY, subject, email_to: email,
      status: res.ok ? "sent" : "failed", provider_id: res.id ?? null, error_message: res.ok ? null : (res.message || `resend_${res.status}`),
    });
    if (res.ok) report.envoyes += 1;
    else { report.echecs += 1; console.error(`[lead-welcome-email] lead ${lead.id} :`, res.message); }
    // Un envoi réussi mais non journalisé repartirait au passage suivant : on arrête l'org.
    if (logErr) { report.error = `journal non écrit (lead ${lead.id}) : ${logErr}`; return; }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  let body: Record<string, unknown> = {};
  try { const t = await req.text(); body = t ? JSON.parse(t) : {}; } catch { return jsonResponse({ error: "invalid_json" }, 400, req); }
  const dryRun = body.dry_run === true;
  const onlyOrgId = typeof body.org_id === "string" ? body.org_id : null;
  if (!RESEND_API_KEY && !dryRun) return jsonResponse({ error: "RESEND_API_KEY manquante" }, 500, req);

  try {
    const admin = getAdminClient();
    let q = admin.schema("core").from("organizations").select("id, name, settings");
    if (onlyOrgId) q = q.eq("id", onlyOrgId);
    const { data: orgs, error } = await q;
    if (error) return jsonResponse({ error: sanitizeError(error, "organizations unreadable") }, 500, req);

    const reports: OrgReport[] = [];
    for (const org of (orgs ?? []) as Array<{ id: string; name: string | null; settings: Record<string, unknown> | null }>) {
      const settings = org.settings ?? {};
      if (!leadWelcomeSettings(settings).enabled) continue;
      const report: OrgReport = { org_id: org.id, name: org.name };
      reports.push(report);
      if (!moduleActif(settings, "communication")) { report.skipped = "module_communication_ferme"; continue; }
      try {
        await traiterOrg(admin, { id: org.id, settings }, dryRun, report);
      } catch (e) {
        report.error = sanitizeError(e, "erreur inattendue");
      }
    }
    const enErreur = reports.some((r) => r.error);
    return jsonResponse({ ok: !enErreur, dry_run: dryRun, reports }, enErreur ? 500 : 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "lead-welcome-email failed") }, 500, req);
  }
});
