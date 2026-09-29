// supabase/functions/auto-rdv/index.ts
// ============================================================================
// auto-rdv — prise de rendez-vous d'entretien par le client (page publique)
// ============================================================================
// Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2 ; plan tranche 2.
// verify_jwt:false (page sans compte) — trois actions :
//   POST { action: "sign", org_id, contract_id } + JWT utilisateur
//        → requireOrgMembership (le helper valide le JWT lui-même) ; le contrat
//          doit appartenir à l'org → { url, expires_at }. Sert au bouton
//          « Copier le lien » (test interne, pose par téléphone) et, en tranche 3,
//          au cron d'invitation.
//   GET  ?token=<jeton>
//        → créneaux calculés À L'INSTANT sur le planning : journées proposables
//          du mois (étiquetées ou déduites, non figées), demi-journées où le
//          contrat s'insère encore (auto-rdv.js), branding de l'org.
//   POST { action: "book", token, creneau: { date, technicien_id, demi, empreinte } }
//        → recalcul du placement sur cette journée seule, puis RPC
//          auto_rdv_poser (tout ou rien, empreinte revérifiée en base).
// Jeton = rdv.<contract_id>.<exp>.<sig>, HMAC-SHA256(MDH_AUTO_RDV_SECRET), sans
// état (même mécanique que mailing-unsubscribe). L'org est TOUJOURS dérivée du
// contrat porté par le jeton, jamais du payload.
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_AUTO_RDV_SECRET,
// MDH_MAPBOX_TOKEN (sinon vol d'oiseau, signalé), MDH_APP_URL (optionnel).
// ============================================================================

import {
  requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError, timingSafeEqual,
} from "../_shared/auth.ts";
import { chargerJournees, chargerContrat } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireReglages } from "../_shared/tournee/reglages.js";
import { construireArretsExistants, minutesVersHeure } from "../_shared/tournee/arrets.js";
import { techniciensEligibles } from "../_shared/tournee/proposer-contrat.js";
import { cleCoord } from "../_shared/tournee/geo.js";
import {
  bornesMois, journeesProposables, creneauxPourContrat, empreinteJournee, demiJournees, placerDansDemiJournee,
} from "../_shared/tournee/auto-rdv.js";

const SECRET = Deno.env.get("MDH_AUTO_RDV_SECRET") || "";
const APP_URL = (Deno.env.get("MDH_APP_URL") || "https://majordhome.vercel.app").replace(/\/+$/, "");
const FUSEAU = "Europe/Paris";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCURRENCE_MATRICE = 4;
const ROLE_COMPETENCE = "entretien";
const LIMITE_PAR_HEURE = 60;

// ── Jeton ─────────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

async function signer(contractId: string, exp: number): Promise<string> {
  const base = `rdv.${contractId}.${exp}`;
  return `${base}.${await hmac(base)}`;
}

type Verif = { ok: true; contractId: string; exp: number } | { ok: false; status: number; error: string };

async function verifier(token: string): Promise<Verif> {
  if (!SECRET) return { ok: false, status: 500, error: "secret_non_configure" };
  if (!token) return { ok: false, status: 400, error: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "rdv") return { ok: false, status: 400, error: "invalid_token" };
  const [, contractId, expStr, sig] = parts;
  if (!UUID.test(contractId)) return { ok: false, status: 400, error: "invalid_token" };
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return { ok: false, status: 400, error: "invalid_token" };
  const attendu = await hmac(`rdv.${contractId}.${expStr}`);
  if (!timingSafeEqual(sig, attendu)) return { ok: false, status: 401, error: "signature_mismatch" };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, status: 410, error: "token_expired" };
  return { ok: true, contractId, exp };
}

/** Composantes de la date locale Europe/Paris. */
function localParis(now = new Date()): { y: number; m: number; d: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), minutes: get("hour") * 60 + get("minute") };
}

function isoLocal(): string {
  const { y, m, d } = localParis();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Expiration du lien : fin du mois en cours (23:59:59 Paris, approché en UTC+2),
 * ou fin du mois suivant s'il reste moins de 7 jours — un lien copié le 28 pour
 * poser par téléphone ne doit pas mourir le 31.
 */
function expirationLien(): number {
  const { y, m, d } = localParis();
  const dernierJour = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cible = dernierJour - d < 7 ? new Date(Date.UTC(y, m + 1, 0)) : new Date(Date.UTC(y, m, 0));
  // 23:59:59 heure de Paris ≈ 21:59:59 UTC (été) / 22:59:59 (hiver) — on prend 22:59:59 UTC, sans conséquence métier.
  return Math.floor(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), cible.getUTCDate(), 22, 59, 59) / 1000);
}

// ── Limite de débit (par jeton, en mémoire) ───────────────────────────────

const compteurs = new Map<string, { n: number; depuis: number }>();
function tropDeRequetes(token: string): boolean {
  const now = Date.now();
  const c = compteurs.get(token);
  if (!c || now - c.depuis > 3_600_000) {
    compteurs.set(token, { n: 1, depuis: now });
    return false;
  }
  c.n += 1;
  return c.n > LIMITE_PAR_HEURE;
}

// ── Chargement commun ─────────────────────────────────────────────────────

function siegeDepuis(settings: Record<string, unknown>): { lat: number; lng: number } | null {
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

interface Contexte {
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
}

type ChargementErreur = { error: string; status: number };

async function charger(admin: ReturnType<typeof getAdminClient>, contractId: string): Promise<Contexte | ChargementErreur> {
  const { data: ct, error: ctErr } = await admin
    .from("majordhome_contracts").select("id, org_id, client_id, status, client_first_name").eq("id", contractId).maybeSingle();
  if (ctErr) return { error: sanitizeError(ctErr, "contrat illisible"), status: 500 };
  if (!ct) return { error: "contrat_introuvable", status: 404 };
  if (ct.status !== "active") return { error: "contrat_inactif", status: 410 };
  const coreOrgId = String(ct.org_id);

  const { data: mdhOrg, error: orgErr } = await admin
    .from("majordhome_organizations").select("id").eq("core_org_id", coreOrgId).maybeSingle();
  if (orgErr || !mdhOrg) return { error: "org_majordhome_introuvable", status: 500 };

  const { data: coreOrg, error: sErr } = await admin
    .schema("core").from("organizations").select("settings").eq("id", coreOrgId).maybeSingle();
  if (sErr) return { error: sanitizeError(sErr, "settings illisibles"), status: 500 };
  const settings = (coreOrg?.settings ?? {}) as Record<string, unknown>;
  const reglages = construireReglages(settings) as Record<string, unknown>;
  const depot = siegeDepuis(settings);
  if (!depot) return { error: "siege_non_configure", status: 422 };

  const { data: contrat, error: cErr } = await chargerContrat({ client: admin, coreOrgId, contractId, reglages });
  if (cErr || !contrat) return { error: cErr ? sanitizeError(cErr, "contrat illisible") : "contrat_introuvable", status: cErr ? 500 : 404 };
  if (contrat.lat == null || contrat.lng == null) return { error: "client_non_localise", status: 422 };

  const aujourdhui = isoLocal();
  const autoRdv = (reglages.auto_rdv ?? {}) as Record<string, unknown>;
  const bornes = bornesMois(aujourdhui, { delaiMinJours: Number(autoRdv.delai_min_jours ?? 2) });
  const joursApres = Math.max(0, joursEntre(aujourdhui, bornes.fin));

  const { data: journees, techniciens, error: jErr } = await chargerJournees({
    client: admin, coreOrgId, mdhOrgId: mdhOrg.id, joursApres, reglages, logger: console,
  });
  if (jErr) return { error: sanitizeError(jErr, "journées illisibles"), status: 500 };
  const eligibles = new Set(
    techniciensEligibles(contrat, techniciens, ROLE_COMPETENCE, { typesParCategorie: contrat.typesParCategorie })
      .map((t: { id: string }) => t.id),
  );

  const { data: etiquettes, error: eErr } = await admin
    .from("majordhome_journees_secteur")
    .select("date, team_member_id, grand_secteur, figee_at")
    .eq("org_id", coreOrgId).gte("date", bornes.debut).lte("date", bornes.fin);
  if (eErr) return { error: sanitizeError(eErr, "étiquettes illisibles"), status: 500 };

  // Secteur « du contrat » = celui du dernier RDV du client (photo grand_secteur), sinon inconnu.
  const { data: dernier } = await admin
    .from("majordhome_appointments").select("grand_secteur")
    .eq("org_id", mdhOrg.id).eq("client_id", ct.client_id).not("grand_secteur", "is", null)
    .order("scheduled_date", { ascending: false }).limit(1).maybeSingle();

  return {
    admin, coreOrgId, mdhOrgId: mdhOrg.id, settings, reglages, depot,
    contrat: contrat as Contexte["contrat"], aujourdhui, bornes,
    journees: (journees as Contexte["journees"]).filter((j) => eligibles.has(j.technicienId)),
    etiquettes: (etiquettes ?? []) as Contexte["etiquettes"],
    secteurContrat: (dernier?.grand_secteur as string | undefined) ?? null,
    clientPrenom: (ct.client_first_name as string | null) ?? null,
  };
}

/** Un RDV d'entretien à venir pour ce client ? (la page affiche alors la date au lieu des créneaux) */
async function rdvDejaPris(ctx: Contexte): Promise<{ date: string; demi: string; technicien: string | null } | null> {
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

/** Matrice de trajets pour un lot de journées (dépôt + arrêts du jour + contrat). */
async function trajetPour(ctx: Contexte, journees: Contexte["journees"]): Promise<{ trajet: (a: string, b: string) => number; estime: boolean }> {
  const token = Deno.env.get("MDH_MAPBOX_TOKEN") || "";
  if (!token) console.error("[auto-rdv] MDH_MAPBOX_TOKEN absent — trajets estimés à vol d'oiseau");
  const chargeur = creerChargeurMatrice({ client: ctx.admin, coreOrgId: ctx.coreOrgId, token, logger: console });
  const paires = new Map<string, number>();
  let estime = !token;
  for (let i = 0; i < journees.length; i += CONCURRENCE_MATRICE) {
    const lot = journees.slice(i, i + CONCURRENCE_MATRICE);
    const resultats = await Promise.all(lot.map((j) => {
      const arrets = construireArretsExistants(j.rdvs as Parameters<typeof construireArretsExistants>[0], ctx.depot);
      const noyau = [ctx.depot, ...arrets.flatMap((a) => {
        if (!a.key) return [];
        const [lat, lng] = a.key.split(",").map(Number);
        return [{ lat, lng }];
      })];
      return chargeur({ noyau, candidats: [ctx.contrat] });
    }));
    for (const r of resultats) {
      if (r.estime) estime = true;
      for (const [k, v] of r.data) paires.set(k, v);
    }
  }
  return { trajet: construireMatrice(paires, { repli: trajetLocal }), estime };
}

function branding(settings: Record<string, unknown>) {
  return {
    name: (settings.brand_name as string) || "Votre entreprise",
    phone: (settings.phone as string) || null,
    logo_url: (settings.logo_url as string) || null,
    accent_color: (settings.accent_color as string) || "#64748b",
  };
}

// ── Actions ───────────────────────────────────────────────────────────────

async function actionSign(req: Request, body: Record<string, unknown>): Promise<Response> {
  const orgId = String(body.org_id || "");
  const contractId = String(body.contract_id || "");
  if (!orgId || !UUID.test(contractId)) return jsonResponse({ error: "org_id et contract_id requis" }, 400, req);
  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;
  if (!SECRET) return jsonResponse({ error: "secret_non_configure" }, 500, req);
  const { data: ct, error } = await auth.supabase
    .from("majordhome_contracts").select("id, org_id").eq("id", contractId).eq("org_id", orgId).maybeSingle();
  if (error) return jsonResponse({ error: sanitizeError(error, "contrat illisible") }, 500, req);
  if (!ct) return jsonResponse({ error: "contrat_introuvable" }, 404, req);
  const exp = expirationLien();
  const token = await signer(contractId, exp);
  return jsonResponse({ url: `${APP_URL}/rdv/${token}`, expires_at: new Date(exp * 1000).toISOString() }, 200, req);
}

async function actionSlots(req: Request, token: string): Promise<Response> {
  const v = await verifier(token);
  if (!v.ok) return jsonResponse({ error: v.error }, v.status, req);
  if (tropDeRequetes(token)) return jsonResponse({ error: "too_many_requests" }, 429, req);
  const ctx = await charger(getAdminClient(), v.contractId);
  if ("error" in ctx) return jsonResponse({ error: ctx.error }, ctx.status, req);

  const deja = await rdvDejaPris(ctx);
  const base = {
    org: branding(ctx.settings),
    client: { prenom: ctx.clientPrenom || null },
    contrat: { categories: ctx.contrat.categories.map((c: { label: string }) => c.label), duree_minutes: ctx.contrat.dureeMinutes },
    mois: ctx.bornes,
    deja,
  };
  if (deja) return jsonResponse({ ...base, creneaux: [], estime: false }, 200, req);

  const proposables = journeesProposables({ journees: ctx.journees, etiquettes: ctx.etiquettes, bornes: ctx.bornes });
  const { trajet, estime } = await trajetPour(ctx, proposables.map((p) => p.journee as Contexte["journees"][number]));
  const autoRdv = (ctx.reglages.auto_rdv ?? {}) as Record<string, unknown>;
  const { creneaux, refus } = creneauxPourContrat({
    contrat: ctx.contrat, proposables, depot: ctx.depot, reglages: ctx.reglages, trajet,
    secteurContrat: ctx.secteurContrat, maxCreneaux: Number(autoRdv.max_creneaux ?? 6),
  });
  return jsonResponse({
    ...base,
    creneaux: creneaux.map((c) => ({
      id: c.id, date: c.date, demi: c.demi, technicien: String(c.technicienNom ?? "").split(" ")[0],
      technicien_id: c.technicienId, debut: c.debut, fin: c.fin, secteur: c.secteur, propre: c.propre, empreinte: c.empreinte,
    })),
    refus, estime,
  }, 200, req);
}

async function actionBook(req: Request, body: Record<string, unknown>, via: "client" | "operateur"): Promise<Response> {
  const token = String(body.token || "");
  const v = await verifier(token);
  if (!v.ok) return jsonResponse({ error: v.error }, v.status, req);
  if (tropDeRequetes(token)) return jsonResponse({ error: "too_many_requests" }, 429, req);
  const k = (body.creneau ?? {}) as Record<string, unknown>;
  const date = String(k.date || "");
  const technicienId = String(k.technicien_id || "");
  const demi = String(k.demi || "");
  const empreinte = String(k.empreinte ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID.test(technicienId) || !["matin", "apres_midi"].includes(demi)) {
    return jsonResponse({ error: "creneau_invalide" }, 400, req);
  }
  const ctx = await charger(getAdminClient(), v.contractId);
  if ("error" in ctx) return jsonResponse({ error: ctx.error }, ctx.status, req);

  const journee = ctx.journees.find((j) => j.date === date && j.technicienId === technicienId);
  if (!journee) return jsonResponse({ error: "creneau_indisponible", raison: "journee" }, 409, req);
  const [prop] = journeesProposables({ journees: [journee], etiquettes: ctx.etiquettes, bornes: ctx.bornes });
  if (!prop) return jsonResponse({ error: "creneau_indisponible", raison: "journee" }, 409, req);
  if (empreinteJournee(journee.rdvs as Parameters<typeof empreinteJournee>[0]) !== empreinte) {
    return jsonResponse({ error: "creneau_indisponible", raison: "journee_modifiee" }, 409, req);
  }
  const { trajet } = await trajetPour(ctx, [journee]);
  const demiObj = demiJournees(ctx.reglages as never).find((d) => d.code === demi)!;
  const reglages = ctx.reglages as Record<string, number | number[] | undefined>;
  const arrets = construireArretsExistants(journee.rdvs as Parameters<typeof construireArretsExistants>[0], ctx.depot, {
    flexDefaut: Number(reglages.souplesse_defaut_minutes ?? 0), amplitude: journee.amplitude as never, demiJournee: ctx.reglages.demi_journee as never,
  });
  const place = placerDansDemiJournee({
    arrets,
    candidat: { id: ctx.contrat.id, key: cleCoord(ctx.contrat), dureeMinutes: ctx.contrat.dureeMinutes },
    demi: demiObj,
    ctx: {
      trajet, depotKey: cleCoord(ctx.depot) ?? "", amplitude: journee.amplitude as never,
      budgetMinutes: Number(journee.budgetMinutes ?? 0) + Number(reglages.depassement_journee_minutes ?? 0),
      pause: { minutes: Number(reglages.pause_minutes ?? 0), fenetre: [((reglages.pause_fenetre as number[])?.[0] ?? 12) * 60, ((reglages.pause_fenetre as number[])?.[1] ?? 14) * 60] },
      trajetMaxMinutes: (reglages.trajet_max_entre_clients_minutes as number | undefined) ?? null,
    },
  });
  if (!place.faisable) return jsonResponse({ error: "creneau_indisponible", raison: place.raison }, 409, req);

  const { data, error } = await ctx.admin.rpc("auto_rdv_poser", {
    p_contract_id: ctx.contrat.id,
    p_team_member_id: technicienId,
    p_date: date,
    p_demi: demi,
    p_start: minutesVersHeure(place.arriveeMinutes!),
    p_end: minutesVersHeure(place.departMinutes!),
    p_duration: ctx.contrat.dureeMinutes,
    p_empreinte: empreinte,
    p_grand_secteur: prop.secteur,
    p_source: `auto_rdv:${via}`,
  });
  if (error) {
    const msg = String(error.message || "");
    const conflit = ["journee_modifiee", "deja_planifie", "journee_figee", "hors_mois", "technicien_invalide", "contrat_inactif"].find((m) => msg.includes(m));
    if (conflit) return jsonResponse({ error: conflit }, 409, req);
    console.error("[auto-rdv] auto_rdv_poser", error);
    return jsonResponse({ error: sanitizeError(error, "pose refusée") }, 500, req);
  }
  return jsonResponse({
    appointment_id: (data as { appointment_id: string }).appointment_id,
    date, demi, technicien: String((journee as { technicienNom?: string }).technicienNom ?? "").split(" ")[0],
    debut: minutesVersHeure(place.arriveeMinutes!),
  }, 200, req);
}

// ── Point d'entrée ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token") || "";
      return await actionSlots(req, token);
    }
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (body.action) {
      case "sign": return await actionSign(req, body);
      case "book": return await actionBook(req, body, body.via === "operateur" ? "operateur" : "client");
      default: return jsonResponse({ error: "action_inconnue" }, 400, req);
    }
  } catch (err) {
    console.error("[auto-rdv]", err);
    return jsonResponse({ error: sanitizeError(err, "erreur interne") }, 500, req);
  }
});
