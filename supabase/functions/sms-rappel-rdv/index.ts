// supabase/functions/sms-rappel-rdv/index.ts
// ============================================================================
// sms-rappel-rdv — rappel automatique des rendez-vous d'entretien (toutes orgs)
// ============================================================================
// pg_cron toutes les heures (5h-19h UTC) → cette edge (verify_jwt:false,
// MDH_CRON_SECRET). Pour chaque org dont `settings.sms.enabled` est vrai, le
// réglage `settings.sms.rappel_rdv` (Settings → Organisation → SMS) décide seul
// s'il y a quelque chose à faire MAINTENANT et pour quelle fenêtre :
//   - veille : chaque jour à H, les RDV du lendemain ;
//   - hebdo  : le jour choisi à H, les RDV des 7 jours suivants ;
//   - off    : rien (défaut).
// L'heure H accepte aussi H+1 : la 2ᵉ passe retente les échecs. Un envoi réussi
// marque `appointments.client_notified_at` (RPC), remis à NULL par trigger si la
// date ou l'heure du RDV change → jamais de doublon, re-notification si déplacé.
//
// Chaîne : sms_rappel_rdv_candidates(org, from, to) → isMobileFR → variables
// (registre `_shared/smsCampaigns.js`, copie synchronisée du front) →
// sendCampaignSms (`_shared/sms.ts`, même cœur que sms-send) → mark_notified.
//
// Body optionnel (appels manuels) :
//   { dry_run: true }        liste ce qui partirait, n'envoie ni ne marque rien
//   { org_id }               limite à une org CORE
//   { force: true }          ignore le jour/l'heure du réglage (fenêtre selon le mode)
//   { from, to }             fenêtre explicite YYYY-MM-DD (≤ 31 jours)
//
// Fuseau : Europe/Paris pour toutes les orgs (majordhome.organizations.timezone
// existe mais n'est pas lu — à brancher le jour où une org n'est pas en métropole).
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET,
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";
import { sendCampaignSms, twilioConfigured, type SmsSettings } from "../_shared/sms.ts";
import {
  buildRappelRdvConfig,
  planifierRappelRdv,
  ajouterJours,
  buildRappelRdvVars,
  smsNameForMember,
} from "../_shared/smsCampaigns.js";
import { isMobileFR } from "../_shared/phoneUtils.js";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const CAMPAIGN = "rappel_rdv";
const TIME_ZONE = "Europe/Paris";
const MAX_WINDOW_DAYS = 31;

interface Candidate {
  appointment_id: string;
  intervention_id: string | null;
  client_id: string | null;
  phone: string | null;
  first_name: string | null;
  scheduled_date: string;
  scheduled_start: string;
  technicians: Array<{ first_name?: string | null; display_name?: string | null }> | null;
}

interface OrgReport {
  org_id: string;
  name: string | null;
  mode: string;
  window?: { debut: string; fin: string } | null;
  skipped?: string;
  error?: string;
  candidates?: number;
  sent?: number;
  no_mobile?: number;
  failed?: number;
  mark_failed?: number;
  preview?: Array<Record<string, unknown>>;
  failures?: Array<{ appointment_id: string; error: string }>;
}

/** Date `YYYY-MM-DD` et heure (0-23) locales Europe/Paris — le cron, lui, vit en UTC. */
function maintenantLocal(now = new Date()): { date: string; heure: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    heure: Number(get("hour")),
  };
}

/** « 06 ** ** ** 38 » — le rapport atterrit dans net._http_response, pas besoin du numéro complet. */
function masquer(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `${digits.slice(0, 2)}…${digits.slice(-2)}` : "…";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400, req);
  }

  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const onlyOrgId = typeof body.org_id === "string" ? body.org_id : null;
  const from = typeof body.from === "string" && ISO_DATE.test(body.from) ? body.from : null;
  const to = typeof body.to === "string" && ISO_DATE.test(body.to) ? body.to : null;
  if ((from && !to) || (!from && to)) {
    return jsonResponse({ error: "from_and_to_required_together" }, 400, req);
  }
  if (from && to) {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days <= MAX_WINDOW_DAYS)) {
      return jsonResponse({ error: "window_invalid", max_days: MAX_WINDOW_DAYS }, 400, req);
    }
  }

  if (!dryRun && !twilioConfigured()) {
    return jsonResponse({ error: "twilio_not_configured" }, 500, req);
  }

  try {
    const admin = getAdminClient();
    const now = maintenantLocal();

    let orgQuery = admin.schema("core").from("organizations").select("id, name, settings");
    if (onlyOrgId) orgQuery = orgQuery.eq("id", onlyOrgId);
    const { data: orgs, error: orgErr } = await orgQuery;
    if (orgErr) {
      return jsonResponse({ error: sanitizeError(orgErr, "organizations unreadable") }, 500, req);
    }

    const reports: OrgReport[] = [];

    for (const org of (orgs ?? []) as Array<{ id: string; name: string | null; settings: Record<string, unknown> | null }>) {
      const sms = (org.settings ?? {}).sms as SmsSettings | undefined;
      if (sms?.enabled !== true) {
        // Une org sans intégration SMS n'a rien à voir avec ce cron : on ne la
        // liste que si on l'a demandée explicitement.
        if (onlyOrgId) reports.push({ org_id: org.id, name: org.name, mode: "n/a", skipped: "sms_disabled" });
        continue;
      }

      const config = buildRappelRdvConfig(sms);
      const report: OrgReport = { org_id: org.id, name: org.name, mode: config.mode };
      reports.push(report);

      // Fenêtre : explicite > forcée (selon le mode) > planifiée par le réglage.
      let window: { debut: string; fin: string } | null = null;
      if (from && to) {
        window = { debut: from, fin: to };
      } else if (force && config.mode === "veille") {
        const demain = ajouterJours(now.date, 1);
        window = { debut: demain, fin: demain };
      } else if (force && config.mode === "hebdo") {
        window = { debut: now.date, fin: ajouterJours(now.date, 6) };
      } else {
        window = planifierRappelRdv(config, now);
      }
      report.window = window;
      if (!window) {
        report.skipped = config.mode === "off" ? "mode_off" : "not_scheduled_now";
        continue;
      }

      const template = sms.templates?.[CAMPAIGN];
      if (!template || (!template.whatsapp && !template.sms)) {
        report.skipped = "campaign_template_missing";
        continue;
      }

      const { data: rows, error: candErr } = await admin.rpc("sms_rappel_rdv_candidates", {
        p_core_org_id: org.id,
        p_from: window.debut,
        p_to: window.fin,
      });
      if (candErr) {
        report.error = sanitizeError(candErr, "candidates failed");
        continue;
      }

      const candidates = (rows ?? []) as Candidate[];
      report.candidates = candidates.length;
      report.sent = 0;
      report.no_mobile = 0;
      report.failed = 0;
      report.mark_failed = 0;
      if (dryRun) report.preview = [];

      for (const c of candidates) {
        const phone = String(c.phone ?? "").trim();
        if (!isMobileFR(phone)) {
          report.no_mobile += 1;
          continue;
        }
        const technicianName = (c.technicians ?? [])
          .map((t) => smsNameForMember(t))
          .filter(Boolean)
          .join(" et ");
        const vars = buildRappelRdvVars({
          clientFirstName: c.first_name,
          date: c.scheduled_date,
          startTime: c.scheduled_start,
          technicianName,
        });

        if (dryRun) {
          report.preview!.push({
            appointment_id: c.appointment_id,
            phone: masquer(phone),
            ...vars,
          });
          continue;
        }

        // Séquentiel, volontairement : quelques dizaines de messages par org et
        // par passe, et un rapport lisible vaut mieux qu'une rafale parallèle.
        const result = await sendCampaignSms(admin, {
          orgId: org.id,
          sms,
          campaign: CAMPAIGN,
          phone,
          clientId: c.client_id,
          interventionId: c.intervention_id,
          vars,
        });

        if (!result.ok) {
          report.failed += 1;
          (report.failures ??= []).push({ appointment_id: c.appointment_id, error: result.error });
          continue;
        }
        report.sent += 1;

        const { error: markErr } = await admin.rpc("sms_rappel_rdv_mark_notified", {
          p_appointment_id: c.appointment_id,
        });
        if (markErr) {
          // Le SMS est parti mais le RDV n'est pas marqué : la passe H+1 le
          // renverrait. Il faut le voir — dans la réponse ET dans les logs.
          report.mark_failed += 1;
          console.error(
            `[sms-rappel-rdv] RDV ${c.appointment_id} envoyé (log ${result.logId}) mais non marqué :`,
            sanitizeError(markErr, "mark_notified failed"),
          );
        }
      }
    }

    return jsonResponse({ now, dry_run: dryRun, force, orgs: reports }, 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "sms-rappel-rdv failed") }, 500, req);
  }
});
