import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Logement MonsieurDPE de la fiche client — appels à l'edge function `dpe-lien` et lectures.
 * L'edge répond 200 `{ data, error }` où `error` est un CODE (traduit par messageErreurDpeLien de @lib/dpeLien).
 * Specs : 2026-11-11-lien-monsieurdpe-fiche-client-design.md, 2026-11-12-logement-monsieurdpe-fiche-client-design.md
 */
async function appeler(orgId, action, extra) {
  const { data, error } = await supabase.functions.invoke('dpe-lien', { body: { org_id: orgId, action, ...extra } });
  if (error) throw new Error('service_injoignable');
  if (data?.error) throw new Error(data.error);
  return data?.data ?? null;
}

const action = (nom, contexte) => (orgId, clientId, extra = {}) =>
  withErrorHandling(() => appeler(orgId, nom, { client_id: clientId, ...extra }), `dpeLien.${contexte || nom}`);

export const dpeLienService = {
  /** Cherche le DPE à l'adresse et rattache s'il est sûr ; sinon enregistre les candidats. → ligne client_dpe */
  rattacher: action('rattacher'),
  /** Un humain choisit un DPE : `{ numero, voisinage? }`. → ligne client_dpe */
  choisir: action('choisir'),
  /** « Ce n'est pas le bon ». → ligne client_dpe */
  detacher: action('detacher'),
  /** Relit la carte du numéro de la fiche. → ligne client_dpe */
  actualiser: action('actualiser'),
  /** Lien du rapport complet : `{ forcer? }`. → { url, numero, deja_emis } */
  ouvrir: action('ouvrir'),
  /** E-mail au client avec le PDF du rapport. → { to, numero } */
  envoyer: action('envoyer'),

  /** La ligne client_dpe de ce client (lecture, tout membre). */
  async getClientDpe(orgId, clientId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_client_dpe')
        .select('*')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'dpeLien.getClientDpe');
  },

  /** L'accès au rapport déjà émis pour ce numéro dans l'organisation (lecture seule, tout membre). */
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
