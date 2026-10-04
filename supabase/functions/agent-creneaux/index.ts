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
//     les 3 meilleures pour nos tournées, présentées dans l'ordre chronologique ;
//   - avec `date_souhaitee` : ce jour-là seulement, y compris une journée vide d'un
//     technicien compétent (« ouvrir un créneau », Eric 2026-10-04), jusqu'à l'horizon
//     d'ouverture (45 j).
// Les créneaux proposés restent côté serveur (agent_propositions) : l'agent ne manipule
// qu'un numéro. La pose recalcule le placement et passe par auto_rdv_poser (source
// `auto_rdv:agent`, p_date_max = horizon), tout ou rien.
//
// Body : { action: "proposer", date_souhaitee?, periode?, conversation_id, agent_id }
//        { action: "reserver", numero, conversation_id, agent_id }
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_VOICE_AGENT_SECRET, MDH_MAPBOX_TOKEN.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireSharedSecret, jsonResponse, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { resoudreOrgAgent } from "../_shared/agentOrg.ts";
import { charger, rdvDejaPris, trajetPour, type Contexte } from "../_shared/autoRdvContexte.ts";
import { minutesVersHeure } from "../_shared/tournee/arrets.js";
import {
  bornesMois, journeesProposables, journeesPourDate, creneauxPourContrat, empreinteJournee, demiJournees, placerParSequencement,
} from "../_shared/tournee/auto-rdv.js";
import { creneauParle, jourParle } from "../_shared/agentTelephonique.js";

const MDH_VOICE_AGENT_SECRET = Deno.env.get("MDH_VOICE_AGENT_SECRET") || "";
const NB_PROPOSITIONS = 3;
const PERIODES = new Set(["matin", "apres_midi"]);

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

type Admin = ReturnType<typeof getAdminClient>;

/** Client vérifié dans cet appel + contrat actif, puis contexte d'offre à l'horizon. */
async function contexteAppel(admin: Admin, orgId: string, conversationId: string): Promise<{ ctx: Contexte } | { raison: string }> {
  const { data, error } = await admin.rpc("agent_creneaux_contexte", { p_org_id: orgId, p_conversation_id: conversationId });
  if (error) throw error;
  if (data?.erreur) return { raison: String(data.erreur) };
  const ctx = await charger(admin, String(data.contract_id), { mode: "horizon" });
  if ("error" in ctx) {
    console.error("[agent-creneaux] contexte :", ctx.error);
    return { raison: ctx.error };
  }
  return { ctx };
}

async function proposer(admin: Admin, orgId: string, conversationId: string, body: Record<string, unknown>) {
  const date = texte(body.date_souhaitee);
  const periode = PERIODES.has(texte(body.periode)) ? texte(body.periode) : null;

  const r = await contexteAppel(admin, orgId, conversationId);
  if ("raison" in r) return { creneaux: [], raison: r.raison };
  const { ctx } = r;

  const deja = await rdvDejaPris(ctx);
  if (deja) return { creneaux: [], raison: "rdv_existant", rdv: { jour: jourParle(deja.date), demi: deja.demi === "matin" ? "le matin" : "l'après-midi" } };

  let proposables;
  if (date) {
    const p = journeesPourDate({ journees: ctx.journees, etiquettes: ctx.etiquettes, date, bornes: ctx.bornes, secteurContrat: ctx.secteurContrat });
    if (p.raison) return { creneaux: [], raison: p.raison };
    proposables = p.proposables;
  } else {
    const autoRdv = (ctx.reglages.auto_rdv ?? {}) as Record<string, unknown>;
    const mois = bornesMois(ctx.aujourdhui, { delaiMinJours: Number(autoRdv.delai_min_jours ?? 2) });
    proposables = journeesProposables({ journees: ctx.journees, etiquettes: ctx.etiquettes, bornes: mois });
  }

  const { trajet } = await trajetPour(ctx, proposables.map((p) => p.journee as Contexte["journees"][number]));
  const { creneaux, refus } = creneauxPourContrat({
    contrat: ctx.contrat, proposables, depot: ctx.depot, reglages: ctx.reglages, trajet,
    secteurContrat: ctx.secteurContrat, maxCreneaux: 50,
  });
  // Les meilleurs pour nos tournées (ordre du moteur), au plus un par demi-journée de date,
  // puis présentés dans l'ordre chronologique.
  const vus = new Set<string>();
  const retenus = creneaux
    .filter((c) => !periode || c.demi === periode)
    .filter((c) => { const k = `${c.date}|${c.demi}`; if (vus.has(k)) return false; vus.add(k); return true; })
    .slice(0, NB_PROPOSITIONS)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.demi === "matin" ? -1 : 1));
  if (!retenus.length) {
    console.log("[agent-creneaux] aucun créneau", JSON.stringify({ date, periode, refus }));
    return { creneaux: [], raison: "aucun_creneau" };
  }

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
  const numero = Number(body.numero);
  if (!Number.isInteger(numero) || numero <= 0) return { reserve: false, raison: "numero_invalide" };

  const r = await contexteAppel(admin, orgId, conversationId);
  if ("raison" in r) return { reserve: false, raison: r.raison };
  const { ctx } = r;

  const { data: prop, error: pErr } = await admin.rpc("agent_proposition_lire", {
    p_org_id: orgId, p_conversation_id: conversationId, p_numero: numero,
  });
  if (pErr) throw pErr;
  if (!prop || prop.contract_id !== ctx.contrat.id) return { reserve: false, raison: "proposition_expiree" };

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
