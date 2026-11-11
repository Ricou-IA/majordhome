import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Lien MonsieurDPE (fiche client) — appels à l'edge function `dpe-lien` et lecture des accès émis.
 * L'edge function répond 200 `{ data, error }` où `error` est un CODE (cf. messageErreurDpeLien de @lib/dpeLien).
 */
async function appeler(orgId, action, extra) {
  const { data, error } = await supabase.functions.invoke('dpe-lien', { body: { org_id: orgId, action, ...extra } });
  if (error) throw new Error('service_injoignable');
  if (data?.error) throw new Error(data.error);
  return data?.data ?? null;
}

export const dpeLienService = {
  /** Les DPE rattachés au bâtiment de l'adresse du client. Rien n'est enregistré. */
  async chercher(orgId, clientId) {
    return withErrorHandling(() => appeler(orgId, 'chercher', { client_id: clientId }), 'dpeLien.chercher');
  },

  /** Ce numéro est-il dans le corpus MonsieurDPE ? → { present, resume } */
  async verifier(orgId, numero) {
    return withErrorHandling(() => appeler(orgId, 'verifier', { numero }), 'dpeLien.verifier');
  },

  /** Le lien du rapport complet pour le DPE enregistré sur la fiche. Émis une fois, relu ensuite. */
  async ouvrir(orgId, clientId, { forcer = false } = {}) {
    return withErrorHandling(() => appeler(orgId, 'ouvrir', { client_id: clientId, forcer }), 'dpeLien.ouvrir');
  },

  /** L'accès déjà émis pour ce numéro dans l'organisation (lecture seule, tout membre). */
  async getAcces(orgId, dpeNumber) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_dpe_report_accesses')
        .select('id, dpe_number, report_url, issued_at')
        .eq('org_id', orgId)
        .eq('dpe_number', dpeNumber)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'dpeLien.getAcces');
  },
};
