// supabase/functions/agent-accueil/index.ts
// ============================================================================
// agent-accueil — webhook d'initiation des appels de l'agent téléphonique (ElevenLabs,
// « conversation initiation client data », appels Twilio entrants).
// Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-reconnaissance-par-numero-design.md
// ============================================================================
// Appelée au décroché, AVANT que Claire ne parle, avec le numéro qui appelle. Renvoie les
// variables dynamiques de l'appel :
//   - `accueil`          : « Bonjour Jean Dupont » / « Bonjour Madame, Monsieur Dupont » /
//                          « Bonjour » — début du premier message de l'agent
//                          (`{{accueil}}, Mayer Énergie, …`) ;
//   - `appelant_reconnu` : nom | famille | commune | neutre ;
//   - `appelant_nom`, `appelant_commune` : pour le prompt (jamais l'adresse, jamais l'équipement) ;
//   - `date_heure_paris` : le réglage `system__timezone` d'ElevenLabs est ignoré.
// Règle de salutation = `accueilDepuisCandidats` (module PUR _shared/agentTelephonique.js,
// copie de src/lib) : jamais de « Monsieur » / « Madame » deviné.
//
// Le numéro appelant est relevé dans majordhome.agent_accueils (RPC
// agent_accueil_enregistrer) : c'est LA source que relit verifier_client — il ne passe
// jamais par l'agent. L'écriture part après la réponse (EdgeRuntime.waitUntil).
//
// L'appel ne doit JAMAIS attendre ni échouer à cause de nous : au-delà de BUDGET_MS, en
// erreur, numéro masqué ou agent inconnu → accueil neutre, HTTP 200.
//
// verify_jwt:false, secret partagé MDH_VOICE_AGENT_SECRET (en-tête Authorization: Bearer …,
// déclaré dans le webhook du workspace ElevenLabs). Org résolue depuis l'agent_id.
// Body (ElevenLabs) : { caller_id, agent_id, called_number, call_sid, conversation_id }
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireSharedSecret, jsonResponse, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { resoudreOrgAgent } from "../_shared/agentOrg.ts";
import { accueilDepuisCandidats, dateHeureParlee, normaliserTelephone } from "../_shared/agentTelephonique.js";

const MDH_VOICE_AGENT_SECRET = Deno.env.get("MDH_VOICE_AGENT_SECRET") || "";
const BUDGET_MS = 1200;

// Global du runtime Supabase Edge (non déclaré par edge-runtime.d.ts) : prolonge la vie
// de l'isolat après la réponse. Absent (deno local) → la promesse tourne quand même.
const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
function apresReponse(p: Promise<unknown>) {
  if (edgeRuntime) edgeRuntime.waitUntil(p);
}

type Accueil = ReturnType<typeof accueilDepuisCandidats>;

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

function reponse(a: Accueil) {
  return jsonResponse({
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      accueil: a.salutation,
      appelant_reconnu: a.mode,
      appelant_nom: a.nom,
      appelant_commune: a.commune,
      date_heure_paris: dateHeureParlee(),
    },
  });
}

const NEUTRE: Accueil = accueilDepuisCandidats([]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const authError = requireSharedSecret(req, MDH_VOICE_AGENT_SECRET, "MDH_VOICE_AGENT_SECRET");
  if (authError) return authError;

  const t0 = Date.now();
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return reponse(NEUTRE);
  }
  const agentId = texte(body.agent_id);
  const conversationId = texte(body.conversation_id);
  const telephone = normaliserTelephone(texte(body.caller_id));
  if (!agentId) return reponse(NEUTRE);

  const admin = getAdminClient();
  const travail = (async (): Promise<{ orgId: string; accueil: Accueil; nb: number } | null> => {
    const org = await resoudreOrgAgent(admin, agentId);
    if ("erreur" in org) {
      console.error(`[agent-accueil] agent_id ${agentId} relié à ${org.nb} org(s)`);
      return null;
    }
    if (!telephone) return { orgId: org.orgId, accueil: NEUTRE, nb: 0 };
    const { data, error } = await admin.rpc("agent_verifier_client_candidats", {
      p_org_id: org.orgId, p_conversation_id: conversationId || "accueil", p_telephone: telephone,
    });
    if (error) throw error;
    const candidats = (data?.candidats ?? []) as Parameters<typeof accueilDepuisCandidats>[0] & unknown[];
    return { orgId: org.orgId, accueil: accueilDepuisCandidats(candidats), nb: candidats.length };
  })();
  travail.catch(() => {}); // une erreur tardive (après le budget) ne doit pas remonter non gérée

  let res: Awaited<typeof travail> = null;
  try {
    res = await Promise.race([
      travail,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BUDGET_MS)),
    ]);
  } catch (err) {
    console.error("[agent-accueil]", sanitizeError(err));
  }
  if (!res) console.error(`[agent-accueil] accueil neutre (budget ${BUDGET_MS} ms dépassé ou erreur)`);
  const accueil = res?.accueil ?? NEUTRE;

  // Relevé du numéro appelant, après la réponse : verifier_client le relira (jamais l'agent).
  // Même si le budget est dépassé, on attend la fin du travail pour l'écrire.
  if (conversationId) {
    apresReponse((async () => {
      try {
        const fin = res ?? await travail;
        if (!fin) return;
        const { error } = await admin.rpc("agent_accueil_enregistrer", {
          p_org_id: fin.orgId, p_conversation_id: conversationId, p_agent_id: agentId,
          p_telephone: telephone, p_mode: fin.accueil.mode, p_nb_fiches: fin.nb,
        });
        if (error) console.error("[agent-accueil] enregistrement :", sanitizeError(error));
      } catch (err) {
        console.error("[agent-accueil] enregistrement :", sanitizeError(err));
      }
    })());
  }

  // Pas de donnée personnelle dans les logs : le mode et la durée seulement.
  console.log("[agent-accueil]", JSON.stringify({ mode: accueil.mode, numero: !!telephone, ms: Date.now() - t0 }));
  return reponse(accueil);
});
