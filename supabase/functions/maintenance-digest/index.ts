// supabase/functions/maintenance-digest/index.ts
// ============================================================================
// maintenance-digest — e-mail du soir du module Maintenance (toutes orgs)
// ============================================================================
// pg_cron toutes les heures → cette edge (verify_jwt:false, MDH_CRON_SECRET). Pour
// chaque org dont `settings.modules.maintenance === true` et
// `settings.maintenance.digest = { enabled: true, recipients: [...], hour }`, à
// l'heure de Paris configurée : récapitulatif du jour (réalisé, en attente, « pas pu
// faire », opérateurs bloqués) construit par `_shared/maintenance/digestModel.js`
// (copie synchronisée du front : MÊME règle d'échéance que la borne).
//
// Règles (spec 2026-09-25-module-maintenance-taches-recurrentes-design.md § 7) :
//   - l'e-mail part MÊME quand tout est à jour (un soir sans e-mail = une panne) ;
//   - expéditeur : from_email de l'org, sinon MDH_PLATFORM_FROM_EMAIL, sinon
//     `skipped: no_sender` (jamais de silence) ;
//   - maint_digest_mark_sent seulement si Resend répond 2xx : sinon l'heure suivante
//     (H+1) retente ; une ligne (org, jour) déjà présente ⇒ rien.
//
// Body optionnel (appels manuels) :
//   { dry_run: true }  construit et renvoie les récapitulatifs, n'envoie ni ne marque rien
//   { org_id }         limite à une org CORE
//   { force: true }    ignore l'heure configurée (garde l'anti-doublon sauf dry_run)
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET, RESEND_API_KEY ;
// optionnel : MDH_PLATFORM_FROM_EMAIL (« Nom <adresse> » ou adresse seule).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";
import { orgBranding, sendResendEmail } from "../_shared/mail.ts";
import { construireDigest, digestHtml } from "../_shared/maintenance/digestModel.js";
import { jourParis, ajouterJours } from "../_shared/maintenance/echeances.js";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const PLATFORM_FROM = (Deno.env.get("MDH_PLATFORM_FROM_EMAIL") || "").trim();
const HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

interface OrgRow { id: string; name: string | null; settings: Record<string, unknown> | null }
interface OrgReport {
  org_id: string;
  name: string | null;
  skipped?: string;
  error?: string;
  sent?: boolean;
  provider_id?: string | null;
  sujet?: string;
  preview?: unknown;
}

// deno-lint-ignore no-explicit-any
type Admin = any;

async function lire(admin: Admin, vue: string, orgId: string, filtre?: (q: Admin) => Admin) {
  let q = admin.from(vue).select("*").eq("org_id", orgId);
  if (filtre) q = filtre(q);
  const { data, error } = await q;
  if (error) throw new Error(`${vue} : ${error.message}`);
  return data || [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  let body: { dry_run?: boolean; org_id?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = body.dry_run === true;
  if (!dryRun && !RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY manquant" }, 500, req);

  const admin = getAdminClient();
  const maintenant = new Date();
  const aujourdhui = jourParis(maintenant);
  const heure = Number(HEURE_PARIS.format(maintenant));

  try {
    let orgQuery = admin.schema("core").from("organizations").select("id, name, settings");
    if (body.org_id) orgQuery = orgQuery.eq("id", body.org_id);
    const { data: orgs, error: orgErr } = await orgQuery;
    if (orgErr) return jsonResponse({ error: sanitizeError(orgErr, "organizations unreadable") }, 500, req);

    const reports: OrgReport[] = [];
    for (const org of (orgs || []) as OrgRow[]) {
      const settings = (org.settings || {}) as Record<string, any>;
      const report: OrgReport = { org_id: org.id, name: org.name };
      const digest = settings.maintenance?.digest;
      if (settings.modules?.maintenance !== true) continue; // module non souscrit : hors périmètre, pas de bruit
      if (digest?.enabled !== true) { report.skipped = "disabled"; reports.push(report); continue; }
      const destinataires = (Array.isArray(digest.recipients) ? digest.recipients : []).filter((e: unknown) => typeof e === "string" && e.includes("@"));
      if (destinataires.length === 0) { report.skipped = "no_recipient"; reports.push(report); continue; }
      const heureVoulue = Number(digest.hour ?? 18);
      // H et H+1 : la 2ᵉ passe retente un échec Resend (l'anti-doublon évite le double envoi).
      if (!body.force && heure !== heureVoulue && heure !== heureVoulue + 1) continue;

      try {
        const deja = await lire(admin, "majordhome_maint_digest_runs", org.id, (q) => q.eq("day", aujourdhui));
        if (deja.length > 0 && !dryRun) { report.skipped = "already_sent"; reports.push(report); continue; }

        const branding = orgBranding(settings);
        const from = branding.fromEmail
          ? (branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail)
          : PLATFORM_FROM;
        if (!from && !dryRun) { report.skipped = "no_sender"; reports.push(report); continue; }

        const [units, tasks, operators, derniers, duJour] = await Promise.all([
          lire(admin, "majordhome_maint_units", org.id),
          lire(admin, "majordhome_maint_tasks", org.id),
          lire(admin, "majordhome_maint_operators", org.id),
          lire(admin, "majordhome_maint_last_logs", org.id),
          lire(admin, "majordhome_maint_task_logs", org.id, (q) => q.gte("done_at", `${ajouterJours(aujourdhui, -1)}T00:00:00Z`)),
        ]);
        const actives = new Set(units.filter((u: any) => !u.archived_at).map((u: any) => u.id));
        const d = construireDigest({
          units,
          tasks: tasks.filter((t: any) => actives.has(t.unit_id)),
          logs: [...derniers, ...duJour],
          operators,
          aujourdhui,
          maintenant: maintenant.toISOString(),
          orgName: branding.brandName || org.name || "",
        });
        report.sujet = d.sujet;

        if (dryRun) {
          report.preview = { from: from || null, to: destinataires, digest: d };
          reports.push(report);
          continue;
        }

        const res = await sendResendEmail(RESEND_API_KEY, {
          from,
          to: destinataires,
          replyTo: branding.replyTo || undefined,
          subject: d.sujet,
          html: digestHtml(d),
        });
        if (!res.ok) {
          report.error = `resend ${res.status} : ${res.message}`;
          reports.push(report);
          continue;
        }
        const { error: markErr } = await admin.rpc("maint_digest_mark_sent", {
          p_org_id: org.id, p_day: aujourdhui, p_provider_id: res.id,
        });
        if (markErr) report.error = `envoyé mais non marqué : ${markErr.message}`;
        report.sent = true;
        report.provider_id = res.id;
        reports.push(report);
      } catch (err) {
        report.error = sanitizeError(err, "digest failed");
        reports.push(report);
      }
    }

    const sent = reports.filter((r) => r.sent).length;
    const errors = reports.filter((r) => r.error).length;
    return jsonResponse({
      day: aujourdhui,
      hour_paris: heure,
      dry_run: dryRun,
      sent,
      errors,
      skipped: reports.filter((r) => r.skipped).map((r) => ({ org_id: r.org_id, reason: r.skipped })),
      reports,
    }, errors > 0 ? 207 : 200, req);
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "maintenance-digest failed") }, 500, req);
  }
});
