// supabase/functions/_shared/agentOrg.ts
// ============================================================================
// Agent téléphonique (ElevenLabs) : résolution de l'organisation depuis l'agent_id.
// L'org n'est JAMAIS lue dans le corps d'une requête d'outil : elle vient de
// core.organizations.settings.telephonie.elevenlabs_agent_id (Settings → Communication
// → Agent téléphonique). Un agent inconnu, ou relié à plusieurs orgs, est refusé.
// Partagé par agent-verifier-client et agent-creneaux.
// ============================================================================

import { getAdminClient } from "./auth.ts";

export async function resoudreOrgAgent(
  supabase: ReturnType<typeof getAdminClient>,
  agentId: string,
): Promise<{ orgId: string } | { erreur: "agent_inconnu"; nb: number }> {
  const { data: orgs, error } = await supabase
    .schema("core")
    .from("organizations")
    .select("id")
    .filter("settings->telephonie->>elevenlabs_agent_id", "eq", agentId);
  if (error) throw error;
  if (!orgs || orgs.length !== 1) return { erreur: "agent_inconnu", nb: orgs?.length ?? 0 };
  return { orgId: orgs[0].id as string };
}
