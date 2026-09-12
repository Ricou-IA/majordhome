// supabase/functions/tournees-figer/index.ts
// ============================================================================
// tournees-figer — figeage automatique des journées PLEINES (toutes orgs)
// ============================================================================
// Spec 2026-09-12 « tournées — bloc contrat et journée pleine », R2-R4.
// pg_cron toutes les heures (5h-19h UTC) → cette edge (verify_jwt:false,
// MDH_CRON_SECRET). Pour chaque org qui envoie des SMS et n'a pas désactivé le
// figeage automatique (`settings.tournees.figer_journee_pleine`), chaque
// journée de l'horizon (à partir de DEMAIN) qui porte encore un RDV adaptable :
//   1. arrêts au barème (chargerJournees, R1) + matrice Mapbox (cache
//      travel_cache d'abord) ;
//   2. pleine ? (`evaluerRemplissage` : reste utile < reste_utile_min_minutes) ;
//   3. ordonnancement dans les tolérances (`sequencerTournee`, figés = faits) ;
//   4. tenue → RPC `tournees_figer_journee` (tout ou rien) → SMS
//      `heure_de_passage` à chaque client dont l'heure vient d'être figée ;
//      pas tenue → rien d'écrit, la journée est « à arbitrer » (rapport +
//      onglet Tournées).
// Décision Eric : dès que c'est plein — pas la veille (« si c'est plein depuis
// 10 jours, pourquoi attendre ? »). Sans gabarit `heure_de_passage`, on ne fige
// rien (figer sans prévenir personne serait pire que ne pas figer).
//
// Body optionnel (appels manuels) :
//   { dry_run: true }   calcule et rapporte, n'écrit ni n'envoie rien
//   { org_id }          limite à une org CORE
//   { date }            limite à une journée YYYY-MM-DD
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET,
// MDH_MAPBOX_TOKEN (sinon vol d'oiseau, signalé), TWILIO_*.
// ============================================================================

import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";
import { sendCampaignSms, twilioConfigured, type SmsSettings } from "../_shared/sms.ts";
import { capitaliserPrenom, formatSmsDate, formatSmsHour } from "../_shared/smsCampaigns.js";
import { isMobileFR } from "../_shared/phoneUtils.js";
import { chargerJournees } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireArretsPourConsolidation, minutesVersHeure, TYPES_ADAPTABLES } from "../_shared/tournee/arrets.js";
import { verdictJournee } from "../_shared/tournee/plein.js";
import { construireReglages } from "../_shared/tournee/reglages.js";
import { cleCoord } from "../_shared/tournee/geo.js";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const CAMPAIGN = "heure_de_passage";
const TIME_ZONE = "Europe/Paris";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Rdv {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_first_name: string | null;
  client_phone: string | null;
  scheduled_start: string;
  duration_minutes: number | null;
  appointment_type: string;
  time_flex_minutes: number | null;
  hour_confirmed_at: string | null;
  lat: number | null;
  lng: number | null;
}

interface JourneeReport {
  date: string;
  technicien: string;
  rdvs: number;
  adaptables: number;
  reste_utile_minutes?: number;
  pleine?: boolean;
  estime?: boolean;
  verdict: "non_pleine" | "figee" | "a_arbitrer" | "refusee" | "dry_run" | "erreur";
  raison?: string;
  diagnostic?: unknown;
  lignes?: Array<{ id: string; label: string; avant: string; apres: string }>;
  sms?: number;
  sms_no_mobile?: number;
  sms_failed?: number;
  refuses?: string[];
  error?: string;
}

interface OrgReport {
  org_id: string;
  name: string | null;
  skipped?: string;
  /** dry_run seulement : le gabarit manque, rien ne se figerait en réel. */
  template_missing?: boolean;
  error?: string;
  journees?: JourneeReport[];
}

/** Date `YYYY-MM-DD` locale Europe/Paris — le cron, lui, vit en UTC. */
function aujourdhuiLocal(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function siegeDepuis(settings: Record<string, unknown>): { lat: number; lng: number } | null {
  const centres = settings?.territoire_centers;
  if (!centres || typeof centres !== "object") return null;
  const premier = Object.values(centres as Record<string, { lat?: unknown; lng?: unknown }>)[0];
  if (!premier || typeof premier.lat !== "number" || typeof premier.lng !== "number") return null;
  return { lat: premier.lat, lng: premier.lng };
}

/** Même lecture que souplesseEffective (src/lib/souplesse.js) : type concerné, pas figé, souplesse > 0. */
function estAdaptable(r: Rdv, flexDefaut: number): boolean {
  if (!TYPES_ADAPTABLES.includes(r.appointment_type)) return false;
  if (r.hour_confirmed_at) return false;
  return (r.time_flex_minutes ?? flexDefaut) > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

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
  const onlyOrgId = typeof body.org_id === "string" ? body.org_id : null;
  const onlyDate = typeof body.date === "string" && ISO_DATE.test(body.date) ? body.date : null;

  if (!dryRun && !twilioConfigured()) return jsonResponse({ error: "twilio_not_configured" }, 500, req);

  try {
    const admin = getAdminClient();
    const aujourdhui = aujourdhuiLocal();
    const token = Deno.env.get("MDH_MAPBOX_TOKEN") || "";
    if (!token) console.error("[tournees-figer] MDH_MAPBOX_TOKEN absent — trajets estimés à vol d'oiseau");

    let orgQuery = admin.schema("core").from("organizations").select("id, name, settings");
    if (onlyOrgId) orgQuery = orgQuery.eq("id", onlyOrgId);
    const { data: orgs, error: orgErr } = await orgQuery;
    if (orgErr) return jsonResponse({ error: sanitizeError(orgErr, "organizations unreadable") }, 500, req);

    const reports: OrgReport[] = [];
    for (const org of (orgs ?? []) as Array<{ id: string; name: string | null; settings: Record<string, unknown> | null }>) {
      const settings = org.settings ?? {};
      const sms = settings.sms as SmsSettings | undefined;
      const tournees = (settings.tournees ?? {}) as Record<string, unknown>;
      const report: OrgReport = { org_id: org.id, name: org.name };

      if (sms?.enabled !== true) {
        if (onlyOrgId) reports.push({ ...report, skipped: "sms_disabled" });
        continue;
      }
      if (tournees.figer_journee_pleine === false) {
        reports.push({ ...report, skipped: "figeage_auto_off" });
        continue;
      }
      const template = sms.templates?.[CAMPAIGN];
      if (!(template && (template.whatsapp || template.sms))) {
        // R4 : sans gabarit, on ne fige rien — figer sans prévenir serait pire.
        // Un dry-run montre quand même ce qui se figerait : c'est ainsi qu'on
        // vérifie le périmètre avant de créer le gabarit.
        if (!dryRun) {
          reports.push({ ...report, skipped: "campaign_template_missing" });
          continue;
        }
        report.template_missing = true;
      }
      const { data: mdhOrg } = await admin.from("majordhome_organizations").select("id").eq("core_org_id", org.id).maybeSingle();
      if (!mdhOrg) {
        if (onlyOrgId) reports.push({ ...report, skipped: "org_majordhome_introuvable" });
        continue;
      }
      const depot = siegeDepuis(settings);
      if (!depot) {
        reports.push({ ...report, skipped: "siege_non_configure" });
        continue;
      }
      reports.push(report);
      report.journees = [];

      const reglages = construireReglages(settings);
      const horizon = Math.max(reglages.horizon_ferme_jours, reglages.horizon_ouverture_jours ?? 45);
      const { data: journees, error: jErr } = await chargerJournees({
        client: admin, coreOrgId: org.id, mdhOrgId: mdhOrg.id, joursApres: horizon, reglages, logger: console,
      });
      if (jErr) {
        report.error = sanitizeError(jErr, "journées illisibles");
        continue;
      }
      const charger = creerChargeurMatrice({ client: admin, coreOrgId: org.id, token, logger: console });
      const flexDefaut = reglages.souplesse_defaut_minutes ?? 0;
      const depotKey = cleCoord(depot) ?? "";

      for (const j of journees as Array<{ date: string; technicienNom: string; rdvs: Rdv[]; amplitude: { debut: number; fin: number }; budgetMinutes: number }>) {
        if (j.date <= aujourdhui) continue; // aujourd'hui : le geste reste humain
        if (onlyDate && j.date !== onlyDate) continue;
        const rdvs = j.rdvs; // TOUS les RDV du jour chargent la journée (une pose aussi)
        const adaptables = rdvs.filter((r) => estAdaptable(r, flexDefaut));
        if (rdvs.length === 0 || adaptables.length === 0) continue;
        const jr: JourneeReport = { date: j.date, technicien: j.technicienNom, rdvs: rdvs.length, adaptables: adaptables.length, verdict: "non_pleine" };
        report.journees.push(jr);
        try {
          const arrets = construireArretsPourConsolidation(
            rdvs as Parameters<typeof construireArretsPourConsolidation>[0], depot,
            { souplesse: true, flexDefaut, amplitude: j.amplitude, demiJournee: reglages.demi_journee },
          );
          const journeeMoteur = { date: j.date, rdvs, amplitude: j.amplitude, budgetMinutes: j.budgetMinutes };

          // Pré-filtre gratuit : si même à vol d'oiseau la journée est loin d'être
          // pleine, inutile d'appeler Mapbox (une matrice par journée, chaque heure).
          const estimation = verdictJournee({ journee: journeeMoteur, depot, reglages, trajet: trajetLocal });
          const resteEstime = estimation.remplissage?.resteUtileMinutes ?? Infinity;
          if (estimation.verdict === "non_pleine" && resteEstime >= (reglages.reste_utile_min_minutes ?? 75) + 60) {
            jr.reste_utile_minutes = resteEstime;
            jr.estime = true;
            continue;
          }

          const noyau = [depot, ...arrets.flatMap((a) => {
            if (!a.key) return [];
            const [lat, lng] = a.key.split(",").map(Number);
            return [{ lat, lng }];
          })];
          const matrice = await charger({ noyau, candidats: [] });
          const trajet = construireMatrice(matrice.data, { repli: trajetLocal });
          jr.estime = matrice.estime;

          // Même verdict que l'onglet Tournées (alerte « à arbitrer »), trajets réels.
          const v = verdictJournee({ journee: journeeMoteur, depot, reglages, trajet });
          jr.reste_utile_minutes = v.remplissage?.resteUtileMinutes;
          jr.pleine = v.remplissage?.pleine ?? false;
          if (v.verdict === "non_pleine" || v.verdict === "sans_adaptable") continue;
          const seq = v.sequence!;
          if (v.verdict === "a_arbitrer") {
            jr.verdict = "a_arbitrer";
            jr.raison = seq.raison ?? undefined;
            jr.diagnostic = seq.diagnostic;
            continue;
          }
          const parId = new Map(rdvs.map((r) => [r.id, r]));
          const arretParId = new Map(arrets.map((a) => [a.id, a]));
          const lignes = seq.planning
            .filter((p: { id: string }) => adaptables.some((a) => a.id === p.id))
            .map((p: { id: string; arriveeMinutes: number }) => {
              const r = parId.get(p.id)!;
              const duree = arretParId.get(p.id)?.dureeMinutes ?? r.duration_minutes ?? 60;
              return {
                id: p.id,
                attendu: r.scheduled_start,
                scheduled_start: minutesVersHeure(p.arriveeMinutes),
                scheduled_end: minutesVersHeure(p.arriveeMinutes + duree),
                duration_minutes: duree,
              };
            });
          jr.lignes = lignes.map((l) => ({
            id: l.id, label: parId.get(l.id)?.client_name ?? l.id, avant: String(l.attendu).slice(0, 5), apres: l.scheduled_start,
          }));
          if (dryRun) {
            jr.verdict = "dry_run";
            continue;
          }

          const { data: ecrit, error: rpcErr } = await admin.rpc("tournees_figer_journee", { p_org_id: mdhOrg.id, p_lignes: lignes });
          if (rpcErr) {
            jr.verdict = "erreur";
            jr.error = sanitizeError(rpcErr, "tournees_figer_journee failed");
            continue;
          }
          const resultat = ecrit as { figes: number; refuses: string[] };
          if (!resultat || resultat.figes === 0) {
            jr.verdict = "refusee";
            jr.refuses = resultat?.refuses ?? [];
            continue;
          }
          jr.verdict = "figee";
          jr.sms = 0;
          jr.sms_no_mobile = 0;
          jr.sms_failed = 0;
          for (const l of lignes) {
            const r = parId.get(l.id)!;
            const phone = String(r.client_phone ?? "").trim();
            if (!isMobileFR(phone)) {
              jr.sms_no_mobile += 1;
              continue;
            }
            const res = await sendCampaignSms(admin, {
              orgId: org.id, sms, campaign: CAMPAIGN, phone, clientId: r.client_id,
              vars: {
                first_name: capitaliserPrenom(r.client_first_name),
                name: r.client_name ?? "",
                date: formatSmsDate(j.date),
                heure: formatSmsHour(l.scheduled_start),
                technicien: String(j.technicienNom ?? "").split(" ")[0],
              },
            });
            if (res.ok) jr.sms += 1;
            else {
              jr.sms_failed += 1;
              console.error(`[tournees-figer] SMS non envoyé RDV ${l.id} :`, res.error);
            }
          }
        } catch (e) {
          jr.verdict = "erreur";
          jr.error = sanitizeError(e, "journée en échec");
        }
      }
    }

    return jsonResponse({ aujourdhui, dry_run: dryRun, orgs: reports }, 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "tournees-figer failed") }, 500, req);
  }
});
