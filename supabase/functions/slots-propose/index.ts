// ============================================================================
// slots-propose — pour UN contrat d'entretien, les créneaux les moins coûteux
// (technicien compétent, trajets réels, RDV déjà posés).
//
// Outil « machine-usable » : appelé par le CTA « Trouver le créneau optimisé »
// de ContractModal aujourd'hui, par le serveur MCP (Hermes / Vapi) demain —
// même entrée, même sortie. Exécute EXACTEMENT le moteur de l'écran : les
// modules importés depuis ../_shared/tournee/ sont des COPIES GÉNÉRÉES de
// src/lib/tournee (npm run sync:tournee-engine, égalité testée).
//
// verify_jwt:true + requireOrgMembership(req, { orgId }) : l'org vient du body
// mais n'est acceptée que si l'utilisateur en est membre — aucun accès
// cross-org possible, RLS ou pas (le client admin filtre en plus par org_id).
//
// Body : { org_id, contract_id, constraints?: { technician_id?, date_from?,
//   date_to?, periode?: 'matin'|'apres_midi', jours_semaine_exclus?: number[],
//   dates_exclues?: string[] }, max_results? (défaut 4, max 10) }
// 200 : { data: { contrat, creneaux[], nouvellesJournees[], raisonsRejet,
//   techniciensEligibles, estime }, error: null }
// 4xx : { error: 'siege_non_configure' | 'client_non_localise' |
//   'contrat_introuvable' | 'aucun_technicien' | … }
//
// Secret : MDH_MAPBOX_TOKEN. Absent ou Mapbox KO → trajets estimés à vol
// d'oiseau, `estime: true` dans la réponse — jamais une 500, jamais en silence.
// Spec : docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md
// ============================================================================
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";
import { chargerJournees, chargerContrat } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { proposerPourContrat, journeesCandidates } from "../_shared/tournee/proposer-contrat.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireArretsExistants } from "../_shared/tournee/arrets.js";
import { construireReglages } from "../_shared/tournee/reglages.js";

const CONCURRENCE_MATRICE = 4; // Mapbox Matrix : 60 req/min sur le tier gratuit
const FUSEAU = "Europe/Paris"; // les journées et « maintenant » sont ceux de l'artisan, pas d'UTC

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Date (YYYY-MM-DD) et heure (minutes depuis minuit) courantes dans le fuseau de l'org. */
function maintenantLocal(): { aujourdhui: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    aujourdhui: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Siège = 1er centre de settings.territoire_centers (même heuristique que getOrgHeadquarters). */
function siegeDepuis(settings: Record<string, unknown>): { lat: number; lng: number } | null {
  const centres = settings?.territoire_centers;
  if (!centres || typeof centres !== "object") return null;
  const premier = Object.values(centres as Record<string, { lat?: unknown; lng?: unknown }>)[0];
  if (!premier || typeof premier.lat !== "number" || typeof premier.lng !== "number") return null;
  return { lat: premier.lat, lng: premier.lng };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const body = await req.json().catch(() => ({}));
    const orgId = String(body.org_id || "");
    if (!orgId) return jsonResponse({ error: "org_id requis" }, 400, req);
    const auth = await requireOrgMembership(req, { orgId });
    if (!auth.ok) return auth.response;
    const admin = auth.supabase;
    const contractId = String(body.contract_id || "");
    if (!contractId) return jsonResponse({ error: "contract_id requis" }, 400, req);

    // Asymétrie d'org : team_members/appointments portent l'org MAJORDHOME,
    // contracts/clients/travel_cache l'org CORE.
    const { data: mdhOrg, error: orgErr } = await admin
      .from("majordhome_organizations").select("id").eq("core_org_id", orgId).maybeSingle();
    if (orgErr || !mdhOrg) return jsonResponse({ error: "org_majordhome_introuvable" }, 500, req);

    const { data: coreOrg, error: settingsErr } = await admin
      .schema("core").from("organizations").select("settings").eq("id", orgId).maybeSingle();
    if (settingsErr) return jsonResponse({ error: sanitizeError(settingsErr, "settings illisibles") }, 500, req);
    const settings = (coreOrg?.settings ?? {}) as Record<string, unknown>;
    const reglages = construireReglages(settings);
    const depot = siegeDepuis(settings);
    if (!depot) return jsonResponse({ error: "siege_non_configure" }, 422, req);

    const { data: contrat, error: cErr } = await chargerContrat({ client: admin, coreOrgId: orgId, contractId, reglages });
    if (cErr || !contrat) {
      // Un contrat absent et une erreur DB (42501, réseau…) ne sont pas la même
      // chose : masquer la seconde en « introuvable » serait un échec silencieux.
      const introuvable = !cErr || cErr.message === "contrat_introuvable";
      return jsonResponse(
        { error: introuvable ? "contrat_introuvable" : sanitizeError(cErr, "contrat illisible") },
        introuvable ? 404 : 500,
        req,
      );
    }
    if (contrat.lat == null || contrat.lng == null) return jsonResponse({ error: "client_non_localise" }, 422, req);

    const horizon = Math.max(reglages.horizon_ferme_jours, reglages.horizon_ouverture_jours ?? 45);
    const { data: journees, techniciens, error: jErr } = await chargerJournees({ reglages,
      client: admin, coreOrgId: orgId, mdhOrgId: mdhOrg.id, joursApres: horizon, logger: console,
    });
    if (jErr) return jsonResponse({ error: sanitizeError(jErr, "journées illisibles") }, 500, req);
    if (!techniciens.length) return jsonResponse({ error: "aucun_technicien" }, 422, req);

    const c = (body.constraints || {}) as Record<string, unknown>;
    const contraintes = {
      technicianId: c.technician_id ? String(c.technician_id) : undefined,
      dateFrom: c.date_from ? String(c.date_from) : undefined,
      dateTo: c.date_to ? String(c.date_to) : undefined,
      periode: (c.periode === "matin" || c.periode === "apres_midi" ? c.periode : undefined) as "matin" | "apres_midi" | undefined,
      joursSemaineExclus: Array.isArray(c.jours_semaine_exclus) ? c.jours_semaine_exclus.map(Number) : [],
      datesExclues: Array.isArray(c.dates_exclues) ? c.dates_exclues.map(String) : [],
    };
    const { aujourdhui, minutes: maintenantMinutes } = maintenantLocal();

    // Matrice : une passe par journée CANDIDATE seulement (technicien éligible,
    // horizon, contraintes) — pas de quota Mapbox brûlé pour une journée que le
    // moteur écartera d'office. Noyau = dépôt + arrêts de la journée, candidat =
    // le contrat ; paires fusionnées dans un seul trajet().
    const candidates = journeesCandidates({ contrat, journees, techniciens, reglages, contraintes, aujourdhui });
    const token = Deno.env.get("MDH_MAPBOX_TOKEN") || "";
    if (!token) console.error("[slots-propose] MDH_MAPBOX_TOKEN absent — trajets estimés à vol d'oiseau");
    const charger = creerChargeurMatrice({ client: admin, coreOrgId: orgId, token, logger: console });
    const paires = new Map<string, number>();
    let estime = !token;
    for (let i = 0; i < candidates.length; i += CONCURRENCE_MATRICE) {
      const lot = candidates.slice(i, i + CONCURRENCE_MATRICE);
      const resultats = await Promise.all(lot.map((j: (typeof journees)[number]) => {
        // `rdvs` est typé `object[]` par la JSDoc du loader ; la forme réelle est celle
        // attendue par construireArretsExistants (id, lat, lng, duration_minutes, scheduled_start).
        const arrets = construireArretsExistants(j.rdvs as Parameters<typeof construireArretsExistants>[0], depot);
        const noyau = [depot, ...arrets.flatMap((a) => {
          if (!a.key) return []; // arrêt sans position : bloque son créneau, rien à envoyer à Mapbox
          const [lat, lng] = a.key.split(",").map(Number);
          return [{ lat, lng }];
        })];
        return charger({ noyau, candidats: [contrat] });
      }));
      for (const r of resultats) {
        if (r.estime) estime = true;
        for (const [k, v] of r.data) paires.set(k, v);
      }
    }
    const trajet = construireMatrice(paires, { repli: trajetLocal });

    const resultat = proposerPourContrat({
      contrat, journees, techniciens, depot, reglages, trajet, estime, contraintes,
      aujourdhui, maintenantMinutes,
      maxResults: Math.min(Math.max(Number(body.max_results) || 4, 1), 10),
    });

    return jsonResponse({
      data: {
        contrat: {
          id: contrat.id, clientId: contrat.clientId, clientName: contrat.clientName, ville: contrat.ville,
          dureeMinutes: contrat.dureeMinutes, categories: contrat.categories, typesNonRenseignes: contrat.typesNonRenseignes,
          sansEquipement: contrat.sansEquipement,
        },
        creneaux: resultat.creneaux.map((k: { debutMinutes: number; finMinutes: number }) => ({
          ...k, debut: hhmm(k.debutMinutes), fin: hhmm(k.finMinutes),
        })),
        nouvellesJournees: resultat.nouvellesJournees,
        raisonsRejet: resultat.raisonsRejet,
        techniciensEligibles: resultat.techniciensEligibles,
        estime,
      },
      error: null,
    }, 200, req);
  } catch (err) {
    console.error("[slots-propose]", err);
    return jsonResponse({ error: sanitizeError(err, "erreur interne") }, 500, req);
  }
});
