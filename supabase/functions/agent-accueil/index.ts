// supabase/functions/agent-accueil/index.ts
// ============================================================================
// agent-accueil — webhook d'initiation des appels de l'agent téléphonique (ElevenLabs,
// « conversation initiation client data », appels Twilio entrants).
// Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-reconnaissance-par-numero-design.md
// ============================================================================
// Appelée au décroché, AVANT que Claire ne parle, avec le numéro qui appelle.
//
// v10.2 (2026-10-04) — AUCUNE variable dynamique personnalisée : ElevenLabs refuse tout
// appel (« missing required dynamic variable ») dès qu'une variable du prompt ou du
// premier message n'est pas fournie, et ses « valeurs par défaut » ne servent qu'aux
// tests du tableau de bord. La personnalisation passe donc par une SURCHARGE du premier
// message (autorisée sur l'agent : overrides → agent.first_message) :
//   message d'accueil de l'org (settings.telephonie.message_accueil, Settings →
//   Communication → Agent téléphonique) dont le « Bonjour » devient « Bonjour Jean
//   Dupont » / « Bonjour Madame, Monsieur Dupont » (`messageAccueilPersonnalise`).
// Le prompt déduit le reste de ce premier message. Accueil neutre ou message non saisi
// → aucune surcharge : l'agent garde son premier message.
// Règle de salutation = `accueilDepuisCandidats` (module PUR _shared/agentTelephonique.js,
// copie de src/lib) : jamais de « Monsieur » / « Madame » deviné.
//
// Le numéro appelant est relevé dans majordhome.agent_accueils (RPC
// agent_accueil_enregistrer) : c'est LA source que relit verifier_client — il ne passe
// jamais par l'agent. L'écriture part après la réponse (EdgeRuntime.waitUntil).
//
// L'appel ne doit JAMAIS attendre ni échouer à cause de nous : au-delà de BUDGET_MS, en
// erreur, numéro masqué ou agent inconnu → aucune surcharge, HTTP 200.
//
// verify_jwt:false, secret partagé MDH_VOICE_AGENT_SECRET (en-tête Authorization: Bearer …,
// déclaré dans le webhook du workspace ElevenLabs). Org résolue depuis l'agent_id.
// Body (ElevenLabs) : { caller_id, agent_id, called_number, call_sid, conversation_id }
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireSharedSecret, jsonResponse, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { resoudreOrgAgent } from "../_shared/agentOrg.ts";
import { accueilDepuisCandidats, messageAccueilPersonnalise, normaliserTelephone } from "../_shared/agentTelephonique.js";

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

/** Réponse d'initiation : surcharge du premier message seulement s'il y a lieu. */
function reponse(premierMessage: string | null) {
  return jsonResponse({
    type: "conversation_initiation_client_data",
    dynamic_variables: {},
    ...(premierMessage ? { conversation_config_override: { agent: { first_message: premierMessage } } } : {}),
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
    return reponse(null);
  }
  const agentId = texte(body.agent_id);
  const conversationId = texte(body.conversation_id);
  const telephone = normaliserTelephone(texte(body.caller_id));
  if (!agentId) return reponse(null);

  const admin = getAdminClient();
  type Travail = { orgId: string; messageAccueil: string | null; accueil: Accueil; nb: number } | null;
  const travail = (async (): Promise<Travail> => {
    const org = await resoudreOrgAgent(admin, agentId);
    if ("erreur" in org) {
      console.error(`[agent-accueil] agent_id ${agentId} relié à ${org.nb} org(s)`);
      return null;
    }
    if (!telephone) return { orgId: org.orgId, messageAccueil: org.messageAccueil, accueil: NEUTRE, nb: 0 };
    const { data, error } = await admin.rpc("agent_verifier_client_candidats", {
      p_org_id: org.orgId, p_conversation_id: conversationId || "accueil", p_telephone: telephone,
    });
    if (error) throw error;
    const candidats = (data?.candidats ?? []) as Parameters<typeof accueilDepuisCandidats>[0] & unknown[];
    return { orgId: org.orgId, messageAccueil: org.messageAccueil, accueil: accueilDepuisCandidats(candidats), nb: candidats.length };
  })();
  travail.catch(() => {}); // une erreur tardive (après le budget) ne doit pas remonter non gérée

  let res: Travail = null;
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
  const premierMessage = res ? messageAccueilPersonnalise(res.messageAccueil, accueil.salutation) : null;
  if (res && accueil.mode !== "neutre" && accueil.mode !== "commune" && !premierMessage) {
    console.error("[agent-accueil] message d'accueil non saisi (Settings → Agent téléphonique) : accueil neutre");
  }

  // Relevé du numéro appelant, après la réponse : verifier_client le relira (jamais l'agent).
  // Même si le budget est dépassé, on attend la fin du travail pour l'écrire. Le mode
  // enregistré est celui réellement prononcé (neutre si aucune surcharge).
  if (conversationId) {
    apresReponse((async () => {
      try {
        const fin = res ?? await travail;
        if (!fin) return;
        const { error } = await admin.rpc("agent_accueil_enregistrer", {
          p_org_id: fin.orgId, p_conversation_id: conversationId, p_agent_id: agentId,
          p_telephone: telephone, p_mode: premierMessage ? fin.accueil.mode : "neutre", p_nb_fiches: fin.nb,
        });
        if (error) console.error("[agent-accueil] enregistrement :", sanitizeError(error));
      } catch (err) {
        console.error("[agent-accueil] enregistrement :", sanitizeError(err));
      }
    })());
  }

  // Pas de donnée personnelle dans les logs : le mode et la durée seulement.
  console.log("[agent-accueil]", JSON.stringify({ mode: premierMessage ? accueil.mode : "neutre", numero: !!telephone, ms: Date.now() - t0 }));
  return reponse(premierMessage);
});
