// supabase/functions/agent-creneaux/index.ts
// ============================================================================
// agent-creneaux — outils `proposer_creneaux` et `reserver_creneau` de l'agent
// téléphonique (ElevenLabs) : proposer puis poser un créneau d'entretien.
// Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-creneaux-design.md
// ============================================================================
// verify_jwt:false, secret partagé MDH_VOICE_AGENT_SECRET (comme agent-verifier-client).
//
// L'agent ne désigne JAMAIS le client : le serveur reprend celui que verifier_client a
// reconnu DANS CET APPEL (RPC agent_creneaux_contexte, journal agent_verifications) et
// son contrat actif. Org résolue depuis l'agent_id (_shared/agentOrg.ts), jamais du corps.
//
// Même moteur que la page client /rdv/:token (_shared/autoRdvContexte.ts +
// _shared/tournee/auto-rdv.js) :
//   - sans date : demi-journées sur les journées à secteur du mois en cours (prolongé),
//     les meilleures pour nos tournées ; s'il en manque, complétées par des journées
//     VIDES (sans secteur), jusqu'à l'horizon d'ouverture — c'est un appel entrant, on
//     satisfait la demande (Eric 2026-10-04 ; vécu : 1 seul créneau proposé à DIEZ alors
//     que 24 journées vides avaient de la place). Au plus 3, une par date × demi-journée,
//     présentées dans l'ordre chronologique (`choisirCreneauxAgent`) ;
//   - avec `date_souhaitee` : ce jour-là seulement, y compris une journée vide d'un
//     technicien compétent (« ouvrir un créneau »), jusqu'à l'horizon d'ouverture (45 j).
// Sur une journée vide, « le premier RDV fixe la zone » : elle prend le secteur du client
// (`secteurClient`), que auto_rdv_poser écrit sur la journée.
// Les créneaux proposés restent côté serveur (agent_propositions) : l'agent ne manipule
// qu'un numéro. La pose ne relit que la journée choisie, recalcule le placement et passe
// par auto_rdv_poser (source `auto_rdv:agent`, p_date_max = horizon), tout ou rien.
//
// Body : { action: "proposer", date_souhaitee?, periode?, conversation_id, agent_id }
//        { action: "reserver", numero, conversation_id, agent_id }
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_VOICE_AGENT_SECRET, MDH_MAPBOX_TOKEN.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireSharedSecret, jsonResponse, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { resoudreOrgAgent } from "../_shared/agentOrg.ts";
import { charger, rdvDejaPris, secteurClient, trajetPour, type Contexte } from "../_shared/autoRdvContexte.ts";
import { minutesVersHeure } from "../_shared/tournee/arrets.js";
import {
  bornesMois, journeesProposables, journeesPourDate, journeesSansSecteur, creneauxPourContrat, empreinteJournee, demiJournees,
  placerParSequencement,
} from "../_shared/tournee/auto-rdv.js";
import { choisirCreneauxAgent, creneauParle, jourParle } from "../_shared/agentTelephonique.js";

const MDH_VOICE_AGENT_SECRET = Deno.env.get("MDH_VOICE_AGENT_SECRET") || "";
const NB_PROPOSITIONS = 3;
const PERIODES = new Set(["matin", "apres_midi"]);

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

type Admin = ReturnType<typeof getAdminClient>;
type Journee = Contexte["journees"][number];

/** Client vérifié dans cet appel + son contrat actif. */
async function contratAppel(admin: Admin, orgId: string, conversationId: string): Promise<{ contractId: string } | { raison: string }> {
  const { data, error } = await admin.rpc("agent_creneaux_contexte", { p_org_id: orgId, p_conversation_id: conversationId });
  if (error) throw error;
  if (data?.erreur) return { raison: String(data.erreur) };
  return { contractId: String(data.contract_id) };
}

/** Contexte d'offre à l'horizon (toutes les journées, ou une seule avec `jour`). */
async function contexteAppel(admin: Admin, orgId: string, conversationId: string, jour: string | null = null): Promise<{ ctx: Contexte } | { raison: string }> {
  const c = await contratAppel(admin, orgId, conversationId);
  if ("raison" in c) return c;
  const ctx = await charger(admin, c.contractId, { mode: "horizon", jour });
  if ("error" in ctx) {
    console.error("[agent-creneaux] contexte :", ctx.error);
    return { raison: ctx.error };
  }
  return { ctx };
}

function creneaux(ctx: Contexte, proposables: Array<{ journee: object; secteur: string | null }>, trajet: (a: string, b: string) => number) {
  return creneauxPourContrat({
    contrat: ctx.contrat, proposables, depot: ctx.depot, reglages: ctx.reglages, trajet,
    secteurContrat: ctx.secteurContrat, maxCreneaux: 50,
  });
}

async function proposer(admin: Admin, orgId: string, conversationId: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const date = texte(body.date_souhaitee);
  const periode = PERIODES.has(texte(body.periode)) ? texte(body.periode) : null;

  const r = await contexteAppel(admin, orgId, conversationId);
  if ("raison" in r) return { creneaux: [], raison: r.raison };
  const { ctx } = r;
  const tContexte = Date.now() - t0;

  const deja = await rdvDejaPris(ctx);
  if (deja) return { creneaux: [], raison: "rdv_existant", rdv: { jour: jourParle(deja.date), demi: deja.demi === "matin" ? "le matin" : "l'après-midi" } };

  let retenus;
  const trace: Record<string, unknown> = { date, periode };
  if (date) {
    // Une date demandée peut tomber sur une journée vide : elle prend le secteur du client.
    const secteur = ctx.secteurContrat ?? await secteurClient(ctx);
    const p = journeesPourDate({ journees: ctx.journees, etiquettes: ctx.etiquettes, date, bornes: ctx.bornes, secteurContrat: secteur });
    if (p.raison) return { creneaux: [], raison: p.raison };
    const { trajet } = await trajetPour(ctx, p.proposables.map((x) => x.journee as Journee));
    const res = creneaux(ctx, p.proposables, trajet);
    trace.refus = res.refus;
    retenus = choisirCreneauxAgent({ dansSecteur: res.creneaux, nombre: NB_PROPOSITIONS, periode });
  } else {
    const autoRdv = (ctx.reglages.auto_rdv ?? {}) as Record<string, unknown>;
    const mois = bornesMois(ctx.aujourdhui, { delaiMinJours: Number(autoRdv.delai_min_jours ?? 2) });
    const aSecteur = journeesProposables({ journees: ctx.journees, etiquettes: ctx.etiquettes, bornes: mois });
    const t1 = await trajetPour(ctx, aSecteur.map((x) => x.journee as Journee));
    const dansSecteur = creneaux(ctx, aSecteur, t1.trajet);
    trace.secteur = { journees: aSecteur.length, creneaux: dansSecteur.creneaux.length, refus: dansSecteur.refus };
    retenus = choisirCreneauxAgent({ dansSecteur: dansSecteur.creneaux, nombre: NB_PROPOSITIONS, periode });

    if (retenus.length < NB_PROPOSITIONS) {
      // Journées vides en complément, du début du mois à l'horizon d'ouverture : les
      // plus proches d'abord (ordre du moteur pour une journée hors secteur = la date).
      const secteur = await secteurClient(ctx);
      const vides = journeesSansSecteur({
        journees: ctx.journees, etiquettes: ctx.etiquettes, bornes: { debut: mois.debut, fin: ctx.bornes.fin }, secteur,
      });
      const t2 = await trajetPour(ctx, vides.map((x) => x.journee as Journee));
      const complement = creneaux(ctx, vides, t2.trajet);
      trace.vides = { journees: vides.length, creneaux: complement.creneaux.length, refus: complement.refus, secteur };
      retenus = choisirCreneauxAgent({ dansSecteur: dansSecteur.creneaux, vides: complement.creneaux, nombre: NB_PROPOSITIONS, periode });
    }
  }
  console.log("[agent-creneaux] proposer", JSON.stringify({ ...trace, retenus: retenus.length, contexte_ms: tContexte, total_ms: Date.now() - t0 }));
  if (!retenus.length) return { creneaux: [], raison: "aucun_creneau" };

  const { data: numeros, error } = await admin.rpc("agent_propositions_enregistrer", {
    p_org_id: orgId, p_conversation_id: conversationId, p_contract_id: ctx.contrat.id,
    p_creneaux: retenus.map((c) => ({ date: c.date, technicien_id: c.technicienId, demi: c.demi, empreinte: c.empreinte, grand_secteur: c.secteur })),
  });
  if (error) throw error;
  const demis = demiJournees(ctx.reglages as never);
  return {
    creneaux: retenus.map((c, i) => ({ numero: (numeros as number[])[i], ...creneauParle(c, demis) })),
  };
}

const CONFLITS = ["journee_modifiee", "decalage_refuse", "deja_planifie", "journee_figee", "hors_mois", "technicien_invalide", "contrat_inactif"];

async function reserver(admin: Admin, orgId: string, conversationId: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const numero = Number(body.numero);
  if (!Number.isInteger(numero) || numero <= 0) return { reserve: false, raison: "numero_invalide" };

  const c = await contratAppel(admin, orgId, conversationId);
  if ("raison" in c) return { reserve: false, raison: c.raison };
  const { data: prop, error: pErr } = await admin.rpc("agent_proposition_lire", {
    p_org_id: orgId, p_conversation_id: conversationId, p_numero: numero,
  });
  if (pErr) throw pErr;
  if (!prop || prop.contract_id !== c.contractId) return { reserve: false, raison: "proposition_expiree" };

  // Seule la journée choisie est relue : c'est la seule que la pose revérifie.
  const ctx = await charger(admin, c.contractId, { mode: "horizon", jour: String(prop.date) });
  if ("error" in ctx) {
    console.error("[agent-creneaux] contexte :", ctx.error);
    return { reserve: false, raison: ctx.error };
  }

  const journee = ctx.journees.find((j) => j.date === prop.date && j.technicienId === prop.technicien_id);
  if (!journee || empreinteJournee(journee.rdvs as Parameters<typeof empreinteJournee>[0]) !== prop.empreinte) {
    return { reserve: false, raison: "creneau_indisponible" };
  }
  const demi = demiJournees(ctx.reglages as never).find((d) => d.code === prop.demi)!;
  const { trajet } = await trajetPour(ctx, [journee]);
  const place = placerParSequencement({
    journee: journee as never, contrat: ctx.contrat as never, demi, depot: ctx.depot, reglages: ctx.reglages as never, trajet,
  });
  if (!place.faisable) return { reserve: false, raison: "creneau_indisponible" };

  const { error } = await admin.rpc("auto_rdv_poser", {
    p_contract_id: ctx.contrat.id,
    p_team_member_id: prop.technicien_id,
    p_date: prop.date,
    p_demi: prop.demi,
    p_start: minutesVersHeure(place.arriveeMinutes!),
    p_end: minutesVersHeure(place.departMinutes!),
    p_duration: ctx.contrat.dureeMinutes,
    p_empreinte: prop.empreinte,
    p_grand_secteur: prop.grand_secteur,
    p_source: "auto_rdv:agent",
    p_decalages: place.decalages,
    p_date_max: ctx.bornes.fin,
  });
  console.log("[agent-creneaux] reserver", JSON.stringify({ ok: !error, total_ms: Date.now() - t0 }));
  if (error) {
    const conflit = CONFLITS.find((m) => String(error.message || "").includes(m));
    if (conflit) return { reserve: false, raison: conflit === "deja_planifie" ? "rdv_existant" : "creneau_indisponible" };
    throw error;
  }
  return { reserve: true, ...creneauParle({ date: prop.date, demi: prop.demi }, demiJournees(ctx.reglages as never)) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const authError = requireSharedSecret(req, MDH_VOICE_AGENT_SECRET, "MDH_VOICE_AGENT_SECRET");
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const conversationId = texte(body.conversation_id);
  const agentId = texte(body.agent_id);
  if (!conversationId || !agentId) return jsonResponse({ error: "conversation_id_et_agent_id_requis" }, 400);

  const admin = getAdminClient();
  try {
    const org = await resoudreOrgAgent(admin, agentId);
    if ("erreur" in org) {
      console.error(`[agent-creneaux] agent_id ${agentId} relié à ${org.nb} org(s)`);
      return jsonResponse({ error: "agent_inconnu" }, 403);
    }
    switch (body.action) {
      case "proposer": return jsonResponse(await proposer(admin, org.orgId, conversationId, body));
      case "reserver": return jsonResponse(await reserver(admin, org.orgId, conversationId, body));
      default: return jsonResponse({ error: "action_inconnue" }, 400);
    }
  } catch (err) {
    // Échec bruyant côté serveur, neutre côté agent : il repasse en « l'équipe vous rappelle ».
    console.error("[agent-creneaux]", sanitizeError(err));
    return jsonResponse({ erreur: "indisponible" }, 500);
  }
});
