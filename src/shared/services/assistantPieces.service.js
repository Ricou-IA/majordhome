import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Assistant « Trouver une pièce » — appels à l'edge function `assistant-pieces` et lecture de l'historique.
 * L'edge répond toujours 200 `{ data, error }` où `error` est un CODE (traduit par messageErreurAssistant de
 * @lib/assistantPieces). Si l'appel lui-même échoue, on jette `service_injoignable` (message générique).
 * Spec : 2026-11-11-assistant-pieces-sav-hermes-design.md
 */
async function appeler(action, orgId, extra) {
  const { data, error } = await supabase.functions.invoke('assistant-pieces', { body: { action, org_id: orgId, ...extra } });
  if (error) throw new Error('service_injoignable');
  if (data?.error) throw new Error(data.error);
  return data?.data ?? null;
}

const COLONNES = 'id, org_id, equipment_id, intervention_id, demande, statut, run_id, reponse, texte_brut, usage, erreur, created_by, created_by_name, created_at, finished_at';

export const assistantPiecesService = {
  /** Lance une recherche (retour immédiat, l'agent travaille environ deux minutes). → { id } */
  lancer(orgId, { equipmentId, interventionId = null, demande }) {
    return withErrorHandling(
      () => appeler('lancer', orgId, { equipment_id: equipmentId, intervention_id: interventionId, demande }),
      'assistantPieces.lancer',
    );
  },

  /** Suit une recherche. → { id, statut, reponse, texte, erreur, created_at, finished_at } */
  suivre(orgId, id) {
    return withErrorHandling(() => appeler('suivre', orgId, { id }), 'assistantPieces.suivre');
  },

  /** Les 20 dernières recherches de cet appareil, la plus récente d'abord (lecture, tout membre). */
  lister(orgId, equipmentId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_assistant_recherches')
        .select(COLONNES)
        .eq('org_id', orgId)
        .eq('equipment_id', equipmentId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    }, 'assistantPieces.lister');
  },
};
