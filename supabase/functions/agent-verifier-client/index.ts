// supabase/functions/agent-verifier-client/index.ts
// ============================================================================
// agent-verifier-client — outil `verifier_client` de l'agent téléphonique (ElevenLabs).
// Spec : docs/superpowers/specs/2026-10-04-agent-telephonique-verifier-client-design.md
// ============================================================================
// Appelée par ElevenLabs pendant l'appel (verify_jwt:false), protégée par le secret
// partagé MDH_VOICE_AGENT_SECRET (Authorization: Bearer …, stocké côté ElevenLabs).
//
// La fiche ne quitte jamais le serveur : l'agent envoie ce que l'appelant a dit
// (nom, commune, adresse, téléphone) ; on lit les fiches qui portent ce téléphone
// (RPC agent_verifier_client_candidats, service_role), on compare en mémoire avec
// la règle PURE partagée (_shared/agentTelephonique.js, copie de src/lib), on
// journalise la tentative (agent_verification_enregistrer), et on ne renvoie qu'un
// verdict — plus équipements / dernier entretien / contrat SI vérifié. Le motif
// d'échec reste en base : jamais d'oracle.
//
// L'org n'est JAMAIS lue dans le corps : elle est résolue depuis l'agent_id
// (variable système injectée par ElevenLabs) via
// core.organizations.settings.telephonie.elevenlabs_agent_id (Settings → Communication
// → Agent téléphonique). Limite : 3 tentatives par conversation.
//
// Body : { nom, commune, adresse, telephone, conversation_id, agent_id }
// Réponse : { verifie: true, equipements, dernier_entretien, contrat_actif, prochain_rdv } | { verifie: false }
// prochain_rdv = { date, heure, motif } du prochain RDV à venir du client, ou null (20261004_2).
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_VOICE_AGENT_SECRET.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireSharedSecret, jsonResponse, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { normaliserTelephone, verifierCandidats } from "../_shared/agentTelephonique.js";

const MDH_VOICE_AGENT_SECRET = Deno.env.get("MDH_VOICE_AGENT_SECRET") || "";
const MAX_TENTATIVES = 3;
const NON_VERIFIE = { verifie: false };

interface Candidat {
  client_id: string;
  last_name: string;
  address: string;
  city: string;
  equipements: string[];
  dernier_entretien: string | null;
  contrat_actif: boolean;
  prochain_rdv: { date: string; heure: string | null; motif: string } | null;
}

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
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

  const entree = {
    nom: texte(body.nom),
    commune: texte(body.commune),
    adresse: texte(body.adresse),
    telephone: texte(body.telephone),
  };
  const conversationId = texte(body.conversation_id);
  const agentId = texte(body.agent_id);
  if (!conversationId || !agentId) return jsonResponse({ error: "conversation_id_et_agent_id_requis" }, 400);

  const supabase = getAdminClient();

  try {
    // Org résolue depuis l'agent : un agent inconnu (ou relié à plusieurs orgs) est refusé.
    const { data: orgs, error: orgError } = await supabase
      .schema("core")
      .from("organizations")
      .select("id")
      .filter("settings->telephonie->>elevenlabs_agent_id", "eq", agentId);
    if (orgError) throw orgError;
    if (!orgs || orgs.length !== 1) {
      console.error(`agent-verifier-client: agent_id ${agentId} relié à ${orgs?.length ?? 0} org(s)`);
      return jsonResponse({ error: "agent_inconnu" }, 403);
    }
    const orgId = orgs[0].id as string;

    const journaliser = async (verifie: boolean, clientId: string | null, nb: number, motif: string | null) => {
      const { error } = await supabase.rpc("agent_verification_enregistrer", {
        p_org_id: orgId,
        p_conversation_id: conversationId,
        p_agent_id: agentId,
        p_verifie: verifie,
        p_client_id: clientId,
        p_nb_candidats: nb,
        p_motif_echec: motif,
      });
      if (error) throw error;
    };

    const telephone = normaliserTelephone(entree.telephone);
    if (!telephone) {
      await journaliser(false, null, 0, "telephone_invalide");
      return jsonResponse(NON_VERIFIE);
    }

    const { data, error } = await supabase.rpc("agent_verifier_client_candidats", {
      p_org_id: orgId,
      p_conversation_id: conversationId,
      p_telephone: telephone,
    });
    if (error) throw error;

    const candidats = (data?.candidats ?? []) as Candidat[];
    if ((data?.tentatives ?? 0) >= MAX_TENTATIVES) {
      await journaliser(false, null, candidats.length, "limite");
      return jsonResponse(NON_VERIFIE);
    }

    const verdict = verifierCandidats(entree, candidats);
    if (!verdict.verifie || !verdict.candidat) {
      await journaliser(false, null, candidats.length, verdict.motif);
      return jsonResponse(NON_VERIFIE);
    }

    const client = verdict.candidat as Candidat;
    await journaliser(true, client.client_id, candidats.length, null);
    return jsonResponse({
      verifie: true,
      equipements: client.equipements ?? [],
      dernier_entretien: client.dernier_entretien,
      contrat_actif: client.contrat_actif === true,
      prochain_rdv: client.prochain_rdv ?? null,
    });
  } catch (err) {
    // Échec bruyant côté serveur (logs), neutre côté agent : le prompt traite l'appelant
    // en nouveau client. Le 500 laisse la trace d'erreur dans l'historique d'outil ElevenLabs.
    console.error("agent-verifier-client:", sanitizeError(err));
    return jsonResponse({ ...NON_VERIFIE, erreur: "indisponible" }, 500);
  }
});
