// supabase/functions/auto-rdv/index.ts
// ============================================================================
// auto-rdv — prise de rendez-vous d'entretien par le client (page publique)
// ============================================================================
// Spec 2026-09-29 « auto-RDV d'entretien mensuel » § 4.2 ; plans tranches 2-3.
// verify_jwt:false (page sans compte) — trois actions :
//   POST { action: "sign", org_id, contract_id } + JWT utilisateur
//        → requireOrgMembership ; le contrat doit appartenir à l'org → { url, expires_at }.
//   GET  ?token=<jeton>
//        → créneaux calculés À L'INSTANT : journées proposables du mois (étiquetées
//          ou déduites, non figées), demi-journées où le contrat s'insère en
//          réordonnançant la journée dans la souplesse de chaque RDV (auto-rdv.js).
//          Marque l'invitation du mois : opened_at, outcome = no_slot si vide.
//   POST { action: "book", token, creneau: { date, technicien_id, demi, empreinte } }
//        → recalcul du placement, RPC auto_rdv_poser (RDV + décalages des voisins,
//          tout ou rien), invitation bookée, e-mail de confirmation (best-effort).
// Jeton : _shared/autoRdvToken.ts (HMAC MDH_AUTO_RDV_SECRET, sans état). L'org est
// TOUJOURS dérivée du contrat porté par le jeton, jamais du payload.
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_AUTO_RDV_SECRET,
// MDH_MAPBOX_TOKEN (sinon vol d'oiseau, signalé), MDH_APP_URL, RESEND_API_KEY.
// ============================================================================

import {
  requireOrgMembership, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError,
} from "../_shared/auth.ts";
import { signer, verifier, expirationLien, isoLocal, secretConfigure, UUID_RE } from "../_shared/autoRdvToken.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml, sendResendEmail, insertMailingLog,
} from "../_shared/mail.ts";
import { chargerJournees, chargerContrat } from "../_shared/tournee/loaders.js";
import { creerChargeurMatrice } from "../_shared/tournee/trajets-core.js";
import { construireMatrice, trajetLocal } from "../_shared/tournee/matrice.js";
import { construireReglages } from "../_shared/tournee/reglages.js";
import { construireArretsExistants, minutesVersHeure } from "../_shared/tournee/arrets.js";
import { techniciensEligibles } from "../_shared/tournee/proposer-contrat.js";
import {
  bornesMois, journeesProposables, creneauxPourContrat, empreinteJournee, demiJournees, placerParSequencement,
} from "../_shared/tournee/auto-rdv.js";
import { AUTO_RDV_CONFIRMATION_TEMPLATE_KEY } from "../_shared/autoRdvEmailTemplates.js";

const APP_URL = (Deno.env.get("MDH_APP_URL") || "https://majordhome.vercel.app").replace(/\/+$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const CONCURRENCE_MATRICE = 4;
const ROLE_COMPETENCE = "entretien";
const LIMITE_PAR_HEURE = 60;
const LIBELLE_DEMI: Record<string, string> = { matin: "le matin", apres_midi: "l’après-midi" };

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

/** 1er du mois d'`aujourdhui` (`YYYY-MM-01`) : clé de l'invitation courante. */
function moisCourant(aujourdhui: string): string {
  return `${aujourdhui.slice(0, 7)}-01`;
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
  clientEmail: string | null;
}

type ChargementErreur = { error: string; status: number };

async function charger(admin: ReturnType<typeof getAdminClient>, contractId: string): Promise<Contexte | ChargementErreur> {
  const { data: ct, error: ctErr } = await admin
    .from("majordhome_contracts").select("id, org_id, client_id, status, client_first_name, client_email").eq("id", contractId).maybeSingle();
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
    clientEmail: (ct.client_email as string | null) ?? null,
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

/** Invitation du mois courant pour ce contrat : mise à jour best-effort (jamais bloquante). */
async function marquerInvitation(ctx: Contexte, patch: Record<string, unknown>, ouSeulementNonBookee = true) {
  try {
    let q = ctx.admin.from("majordhome_auto_rdv_invitations").update(patch)
      .eq("org_id", ctx.coreOrgId).eq("contract_id", ctx.contrat.id).eq("mois", moisCourant(ctx.aujourdhui));
    if (ouSeulementNonBookee) q = q.is("booked_at", null);
    const { error } = await q;
    if (error) console.error("[auto-rdv] invitation non mise à jour :", error);
  } catch (e) {
    console.error("[auto-rdv] invitation :", e);
  }
}

function formatDateLongue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** E-mail de confirmation (gabarit auto_rdv_confirmation), best-effort : l'échec n'annule pas la pose. */
async function envoyerConfirmation(ctx: Contexte, p: { date: string; demi: string; technicien: string }): Promise<string | null> {
  try {
    if (!RESEND_API_KEY || !ctx.clientEmail) return null;
    const { data: tpl } = await ctx.admin
      .from("majordhome_mail_campaigns").select("subject, html_body")
      .eq("org_id", ctx.coreOrgId).eq("key", AUTO_RDV_CONFIRMATION_TEMPLATE_KEY).eq("is_archived", false).maybeSingle();
    if (!tpl) return "template_missing";
    const b = orgBranding(ctx.settings as never);
    if (!b.fromEmail) return "no_from_email";
    const valeurs: Record<string, string> = {
      "{{PRENOM}}": ctx.clientPrenom || "",
      "{{DATE_RDV}}": formatDateLongue(p.date),
      "{{DEMI_JOURNEE}}": LIBELLE_DEMI[p.demi] || p.demi,
      "{{TECHNICIEN}}": p.technicien || "notre technicien",
    };
    const html = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, escapeHtml(v)]));
    const remplacements = { ...brandingReplacements(b), ...html };
    const subject = applyPlaceholders(String(tpl.subject || ""), { ...brandingReplacements(b), ...valeurs });
    const body = applyPlaceholders(wrapWithSkeleton(b, String(tpl.html_body || "")), remplacements);
    const res = await sendResendEmail(RESEND_API_KEY, {
      from: b.fromName ? `${b.fromName} <${b.fromEmail}>` : b.fromEmail, to: [ctx.clientEmail],
      replyTo: b.replyTo || undefined, subject, html: body,
    });
    await insertMailingLog(ctx.admin, {
      client_id: ctx.contrat.clientId, org_id: ctx.coreOrgId, campaign_name: AUTO_RDV_CONFIRMATION_TEMPLATE_KEY,
      subject, email_to: ctx.clientEmail, status: res.ok ? "sent" : "failed", provider_id: res.id ?? null,
      error_message: res.ok ? null : (res.message || `resend_${res.status}`),
    } as never);
    return res.ok ? "sent" : "failed";
  } catch (e) {
    console.error("[auto-rdv] confirmation :", e);
    return "failed";
  }
}

// ── Actions ───────────────────────────────────────────────────────────────

async function actionSign(req: Request, body: Record<string, unknown>): Promise<Response> {
  const orgId = String(body.org_id || "");
  const contractId = String(body.contract_id || "");
  if (!orgId || !UUID_RE.test(contractId)) return jsonResponse({ error: "org_id et contract_id requis" }, 400, req);
  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;
  if (!secretConfigure()) return jsonResponse({ error: "secret_non_configure" }, 500, req);
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
  // Suivi de l'invitation du mois : page ouverte ; « sans créneau » si rien à proposer.
  await marquerInvitation(ctx, creneaux.length === 0
    ? { opened_at: new Date().toISOString(), outcome: "no_slot" }
    : { opened_at: new Date().toISOString() });
  if (creneaux.length > 0) {
    // Ne pas laisser un « no_slot » d'une visite précédente masquer une offre revenue.
    await marquerInvitation(ctx, { outcome: null });
  }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(technicienId) || !["matin", "apres_midi"].includes(demi)) {
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
  const place = placerParSequencement({
    journee: journee as never, contrat: ctx.contrat as never, demi: demiObj, depot: ctx.depot, reglages: ctx.reglages as never, trajet,
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
    p_decalages: place.decalages,
  });
  if (error) {
    const msg = String(error.message || "");
    const conflit = ["journee_modifiee", "decalage_refuse", "deja_planifie", "journee_figee", "hors_mois", "technicien_invalide", "contrat_inactif"].find((m) => msg.includes(m));
    if (conflit) return jsonResponse({ error: conflit }, 409, req);
    console.error("[auto-rdv] auto_rdv_poser", error);
    return jsonResponse({ error: sanitizeError(error, "pose refusée") }, 500, req);
  }
  const res = data as { appointment_id: string; intervention_id: string; decales?: number };
  const technicien = String((journee as { technicienNom?: string }).technicienNom ?? "").split(" ")[0];
  await marquerInvitation(ctx, {
    booked_at: new Date().toISOString(), appointment_id: res.appointment_id, intervention_id: res.intervention_id, outcome: "booked",
  });
  const confirmation = await envoyerConfirmation(ctx, { date, demi, technicien });
  return jsonResponse({
    appointment_id: res.appointment_id, date, demi, technicien,
    debut: minutesVersHeure(place.arriveeMinutes!), decales: res.decales ?? 0, confirmation,
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
