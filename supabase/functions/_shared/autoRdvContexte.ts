// supabase/functions/_shared/autoRdvContexte.ts
// ============================================================================
// Contexte de l'offre d'entretien « auto-RDV » : contrat, réglages, dépôt, journées
// des techniciens éligibles, étiquettes de secteur, trajets. Partagé par :
//   - l'edge `auto-rdv` (page client /rdv/:token) — bornes = mois en cours (`mois`) ;
//   - l'edge `agent-creneaux` (agent téléphonique) — bornes = horizon d'ouverture
//     (`horizon`), pour pouvoir ouvrir un créneau à la date demandée.
// Extrait de auto-rdv/index.ts le 2026-10-04 (spec agent-telephonique-creneaux) :
// une seule lecture du contexte, jamais deux copies qui divergent.
//
// Temps de réponse (mesuré le 2026-10-04 sur un appel réel : 8,8 s pour proposer,
// 5,2 s pour réserver — l'agent est au téléphone pendant ce temps) :
//   - les lectures indépendantes partent en parallèle ;
//   - `jour` : réservation = UNE journée relue (la seule que la pose revérifie),
//     pas les 45 jours de l'offre ;
//   - `trajetPour` charge d'abord le client ↔ tous les points de toutes les journées
//     (2 lots Mapbox en parallèle au lieu de 2 appels successifs PAR journée), puis les
//     trajets internes de chaque journée, en parallèle, servis par le cache.
// ============================================================================

import { getAdminClient, sanitizeError } from "./auth.ts";
import { isoLocal } from "./autoRdvToken.ts";
import { chargerJournees, chargerContrat } from "./tournee/loaders.js";
import { creerChargeurMatrice } from "./tournee/trajets-core.js";
import { construireMatrice, trajetLocal } from "./tournee/matrice.js";
import { construireReglages } from "./tournee/reglages.js";
import { construireArretsExistants } from "./tournee/arrets.js";
import { techniciensEligibles } from "./tournee/proposer-contrat.js";
import { cleCoord } from "./tournee/geo.js";
import { secteurMajoritaire, normaliserSecteur } from "./tournee/secteurs.js";
import { bornesMois, bornesHorizon, demiJournees } from "./tournee/auto-rdv.js";

const ROLE_COMPETENCE = "entretien";
// Plafond Mapbox Matrix = 25 coordonnées par appel : le client + 24 points.
const POINTS_PAR_LOT = 24;
// Trajets internes des journées : presque toujours en cache ; borne la concurrence
// pour le cas où Mapbox serait sollicité (quota de requêtes par minute).
const CONCURRENCE_JOURNEES = 8;

export function siegeDepuis(settings: Record<string, unknown>): { lat: number; lng: number } | null {
  const centres = settings?.territoire_centers;
  if (!centres || typeof centres !== "object") return null;
  const premier = Object.values(centres as Record<string, { lat?: unknown; lng?: unknown }>)[0];
  if (!premier || typeof premier.lat !== "number" || typeof premier.lng !== "number") return null;
  return { lat: premier.lat, lng: premier.lng };
}

function joursEntre(debutIso: string, finIso: string): number {
  const [y1, m1, d1] = debutIso.split("-").map(Number);
  const [y2, m2, d2] = finIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export interface Contexte {
  admin: ReturnType<typeof getAdminClient>;
  coreOrgId: string;
  mdhOrgId: string;
  settings: Record<string, unknown>;
  reglages: Record<string, unknown>;
  depot: { lat: number; lng: number };
  contrat: Awaited<ReturnType<typeof chargerContrat>>["data"] & { lat: number; lng: number };
  aujourdhui: string;
  bornes: { debut: string; fin: string };
  journees: Array<Record<string, unknown> & { date: string; technicienId: string; rdvs: Array<Record<string, unknown>> }>;
  etiquettes: Array<{ date: string; team_member_id: string; grand_secteur: string | null; figee_at: string | null }>;
  secteurContrat: string | null;
  clientPrenom: string | null;
  clientEmail: string | null;
  clientCodePostal: string | null;
  clientVille: string | null;
}

export type ChargementErreur = { error: string; status: number };

/**
 * Charge le contexte d'un contrat ACTIF. `mode` fixe les bornes de l'offre :
 * `mois` (défaut, page client) = mois en cours prolongé ; `horizon` (agent) =
 * J+`delai_min_jours` → J+`horizon_ouverture_jours`.
 * `jour` (AAAA-MM-JJ) : ne relit QUE cette journée (journées et étiquettes) — pour une
 * réservation, qui ne revérifie que le créneau choisi. Les bornes restent celles du mode.
 */
export async function charger(
  admin: ReturnType<typeof getAdminClient>,
  contractId: string,
  { mode = "mois", jour = null }: { mode?: "mois" | "horizon"; jour?: string | null } = {},
): Promise<Contexte | ChargementErreur> {
  const { data: ct, error: ctErr } = await admin
    .from("majordhome_contracts")
    .select("id, org_id, client_id, status, client_first_name, client_email, client_postal_code, client_city")
    .eq("id", contractId).maybeSingle();
  if (ctErr) return { error: sanitizeError(ctErr, "contrat illisible"), status: 500 };
  if (!ct) return { error: "contrat_introuvable", status: 404 };
  if (ct.status !== "active") return { error: "contrat_inactif", status: 410 };
  const coreOrgId = String(ct.org_id);

  const [{ data: mdhOrg, error: orgErr }, { data: coreOrg, error: sErr }] = await Promise.all([
    admin.from("majordhome_organizations").select("id").eq("core_org_id", coreOrgId).maybeSingle(),
    admin.schema("core").from("organizations").select("settings").eq("id", coreOrgId).maybeSingle(),
  ]);
  if (orgErr || !mdhOrg) return { error: "org_majordhome_introuvable", status: 500 };
  if (sErr) return { error: sanitizeError(sErr, "settings illisibles"), status: 500 };
  const settings = (coreOrg?.settings ?? {}) as Record<string, unknown>;
  const reglages = construireReglages(settings) as Record<string, unknown>;
  const depot = siegeDepuis(settings);
  if (!depot) return { error: "siege_non_configure", status: 422 };

  const aujourdhui = isoLocal();
  const autoRdv = (reglages.auto_rdv ?? {}) as Record<string, unknown>;
  const delaiMinJours = Number(autoRdv.delai_min_jours ?? 2);
  const bornes = mode === "horizon"
    ? bornesHorizon(aujourdhui, { delaiMinJours, horizonJours: Number(reglages.horizon_ouverture_jours ?? 45) })
    : bornesMois(aujourdhui, { delaiMinJours });
  const lecture = jour ? { debut: jour, fin: jour } : bornes;

  // Tout ce qui ne dépend que du contrat et des réglages part en même temps.
  const [contratRes, journeesRes, etiquettesRes, dernierRes] = await Promise.all([
    chargerContrat({ client: admin, coreOrgId, contractId, reglages }),
    chargerJournees({
      client: admin, coreOrgId, mdhOrgId: mdhOrg.id, reglages, logger: console,
      ...(jour
        ? { maintenant: new Date(`${jour}T12:00:00Z`), joursApres: 0 }
        : { joursApres: Math.max(0, joursEntre(aujourdhui, bornes.fin)) }),
    }),
    admin.from("majordhome_journees_secteur")
      .select("date, team_member_id, grand_secteur, figee_at")
      .eq("org_id", coreOrgId).gte("date", lecture.debut).lte("date", lecture.fin),
    admin.from("majordhome_appointments").select("grand_secteur")
      .eq("org_id", mdhOrg.id).eq("client_id", ct.client_id).not("grand_secteur", "is", null)
      .order("scheduled_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const { data: contrat, error: cErr } = contratRes;
  if (cErr || !contrat) return { error: cErr ? sanitizeError(cErr, "contrat illisible") : "contrat_introuvable", status: cErr ? 500 : 404 };
  if (contrat.lat == null || contrat.lng == null) return { error: "client_non_localise", status: 422 };
  const { data: journees, techniciens, error: jErr } = journeesRes;
  if (jErr) return { error: sanitizeError(jErr, "journées illisibles"), status: 500 };
  if (etiquettesRes.error) return { error: sanitizeError(etiquettesRes.error, "étiquettes illisibles"), status: 500 };

  const eligibles = new Set(
    techniciensEligibles(contrat, techniciens, ROLE_COMPETENCE, { typesParCategorie: contrat.typesParCategorie })
      .map((t: { id: string }) => t.id),
  );

  return {
    admin, coreOrgId, mdhOrgId: mdhOrg.id, settings, reglages, depot,
    contrat: contrat as Contexte["contrat"], aujourdhui, bornes,
    journees: (journees as Contexte["journees"]).filter((j) => eligibles.has(j.technicienId)),
    etiquettes: (etiquettesRes.data ?? []) as Contexte["etiquettes"],
    secteurContrat: (dernierRes.data?.grand_secteur as string | undefined) ?? null,
    clientPrenom: (ct.client_first_name as string | null) ?? null,
    clientEmail: (ct.client_email as string | null) ?? null,
    clientCodePostal: (ct.client_postal_code as string | null) ?? null,
    clientVille: (ct.client_city as string | null) ?? null,
  };
}

/**
 * Secteur du client, pour fixer la zone d'une journée VIDE sur laquelle on le pose
 * (« le premier RDV fixe la zone », Eric 2026-10-04) : celui de son dernier RDV ; à
 * défaut, le secteur majoritaire des RDV déjà posés dans son code postal (même partition
 * que la Programmation, figée sur chaque RDV à sa création) ; à défaut, sa commune.
 */
export async function secteurClient(ctx: Contexte): Promise<string | null> {
  if (ctx.secteurContrat) return normaliserSecteur(ctx.secteurContrat) || null;
  const cp = String(ctx.clientCodePostal || "").trim();
  if (cp) {
    const { data, error } = await ctx.admin
      .from("majordhome_appointments").select("grand_secteur")
      .eq("org_id", ctx.mdhOrgId).eq("postal_code", cp).not("grand_secteur", "is", null)
      .order("scheduled_date", { ascending: false }).limit(200);
    if (error) console.error("[auto-rdv] secteur par code postal illisible :", sanitizeError(error, ""));
    const s = secteurMajoritaire((data ?? []).map((r) => r.grand_secteur as string));
    if (s) return s;
  }
  return normaliserSecteur(ctx.clientVille) || null;
}

/** Un RDV d'entretien à venir pour ce client ? (pas de second RDV posé par-dessus) */
export async function rdvDejaPris(ctx: Contexte): Promise<{ date: string; demi: string; technicien: string | null } | null> {
  const { data } = await ctx.admin
    .from("majordhome_appointments").select("id, scheduled_date, scheduled_start")
    .eq("org_id", ctx.mdhOrgId).eq("client_id", ctx.contrat.clientId).eq("appointment_type", "maintenance")
    .gte("scheduled_date", ctx.aujourdhui).not("status", "in", "(cancelled,no_show)")
    .order("scheduled_date", { ascending: true }).limit(1).maybeSingle();
  if (!data) return null;
  const minutes = Number(String(data.scheduled_start).slice(0, 2)) * 60 + Number(String(data.scheduled_start).slice(3, 5));
  const [matin] = demiJournees(ctx.reglages as never);
  const j = ctx.journees.find((x) => x.date === data.scheduled_date && (x.rdvs as Array<{ id: string }>).some((r) => r.id === data.id));
  return {
    date: String(data.scheduled_date),
    demi: minutes < matin.fin ? "matin" : "apres_midi",
    technicien: j ? String((j as { technicienNom?: string }).technicienNom ?? "").split(" ")[0] : null,
  };
}

/** Dépôt + arrêts localisés d'une journée (le « noyau » du chargeur de matrice). */
function noyauDe(ctx: Contexte, j: Contexte["journees"][number]): Array<{ lat: number; lng: number }> {
  const arrets = construireArretsExistants(j.rdvs as Parameters<typeof construireArretsExistants>[0], ctx.depot);
  return [ctx.depot, ...arrets.flatMap((a) => {
    if (!a.key) return [];
    const [lat, lng] = a.key.split(",").map(Number);
    return [{ lat, lng }];
  })];
}

async function parLots<T, R>(items: T[], taille: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += taille) out.push(...await Promise.all(items.slice(i, i + taille).map(f)));
  return out;
}

/**
 * Matrice de trajets pour un lot de journées (dépôt + arrêts du jour + contrat).
 * Deux temps (même chargeur, même cache, même quota Mapbox qu'avant — seul l'ordre change) :
 *   1. le CLIENT ↔ tous les points distincts de toutes les journées, par lots de 24 en
 *      parallèle (le client est le seul point jamais vu : c'est là que Mapbox travaille) ;
 *   2. les trajets internes de chaque journée, en parallèle — déjà en cache dans
 *      l'immense majorité des cas (calculés à la pose des RDV).
 */
export async function trajetPour(ctx: Contexte, journees: Contexte["journees"]): Promise<{ trajet: (a: string, b: string) => number; estime: boolean }> {
  const token = Deno.env.get("MDH_MAPBOX_TOKEN") || "";
  if (!token) console.error("[auto-rdv] MDH_MAPBOX_TOKEN absent — trajets estimés à vol d'oiseau");
  const chargeur = creerChargeurMatrice({ client: ctx.admin, coreOrgId: ctx.coreOrgId, token, logger: console });
  const paires = new Map<string, number>();
  let estime = !token;
  const ajouter = (r: { data: Map<string, number>; estime: boolean }) => {
    if (r.estime) estime = true;
    for (const [k, v] of r.data) paires.set(k, v);
  };

  const noyaux = journees.map((j) => noyauDe(ctx, j));
  const cleClient = cleCoord(ctx.contrat);
  const points = [...new Map(noyaux.flat().map((p) => [cleCoord(p), p])).entries()]
    .filter(([k]) => k && k !== cleClient).map(([, p]) => p);
  const lots: Array<Array<{ lat: number; lng: number }>> = [];
  for (let i = 0; i < points.length; i += POINTS_PAR_LOT) lots.push(points.slice(i, i + POINTS_PAR_LOT));
  (await Promise.all(lots.map((lot) => chargeur({ noyau: [ctx.contrat], candidats: lot })))).forEach(ajouter);

  (await parLots(noyaux, CONCURRENCE_JOURNEES, (noyau) => chargeur({ noyau, candidats: [ctx.contrat] }))).forEach(ajouter);

  return { trajet: construireMatrice(paires, { repli: trajetLocal }), estime };
}
