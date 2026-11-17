/**
 * pipelineDashboard.service.js — lecture des données du Dashboard du pipeline.
 * ============================================================================
 * Quatre lectures brutes (leads, cartes du Kanban, RDV commerciaux, devis
 * rattachés) ; tout le calcul est dans `src/lib/pipelineDashboard.js`.
 *
 * Chaque lecture est PAGINÉE : PostgREST plafonne une réponse à 1 000 lignes sans
 * rien signaler, et un tableau de bord calculé sur une liste tronquée serait faux
 * en silence (les leads et les cartes d'une org dépassent déjà 600 lignes).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, getMajordhomeOrgId } from '@/lib/serviceHelpers';

const PAGE = 1000;

/**
 * Lit toutes les lignes d'une requête, page après page.
 * @param {() => any} requete fabrique la requête (filtres + tri STABLE), sans `.range()`
 */
async function toutLire(requete) {
  const lignes = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await requete().range(debut, debut + PAGE - 1);
    if (error) throw error;
    lignes.push(...(data || []));
    if (!data || data.length < PAGE) return lignes;
  }
}

const COLONNES_LEADS = 'id, created_date, assigned_user_id, source_id, won_date, status_is_won, status_is_final, '
  + 'status_changed_at, is_long_term_project, last_followup_date, last_interaction_at, quote_sent_date, order_amount_ht';

const COLONNES_CARTES = 'card_key, lead_id, column_key, total_amount, devis_count, has_active_rdv, first_quote_date, quotes_validated_at';

/** Types de RDV commerciaux et statuts écartés : mêmes listes que la vue majordhome_kanban_cards. */
const TYPES_RDV_COMMERCIAUX = ['rdv_technical', 'rdv_agency'];
const STATUTS_RDV_ECARTES = '(cancelled,no_show)';

/**
 * @param {string} orgId  org CORE
 * @param {string} depuis `YYYY-MM-DD` : premier jour utile pour les RDV et les devis
 *                        (les leads et les cartes sont lus en entier : le portefeuille n'a pas d'âge)
 * @returns {Promise<{ leads: Object[], cards: Object[], rdvs: Object[], devis: Object[] }>}
 */
async function lireDonnees(orgId, depuis) {
  // Les RDV portent l'org majordhome, pas l'org core.
  const mhOrgId = await getMajordhomeOrgId(orgId);

  const [leads, cards, rdvs, devisBruts] = await Promise.all([
    toutLire(() => supabase
      .from('majordhome_leads')
      .select(COLONNES_LEADS)
      .eq('org_id', orgId)
      .eq('is_deleted', false)
      .order('id')),
    toutLire(() => supabase
      .from('majordhome_kanban_cards')
      .select(COLONNES_CARTES)
      .eq('org_id', orgId)
      .order('card_key')),
    toutLire(() => supabase
      .from('majordhome_appointments')
      .select('id, lead_id, scheduled_date')
      .eq('org_id', mhOrgId)
      .not('lead_id', 'is', null)
      .in('appointment_type', TYPES_RDV_COMMERCIAUX)
      .not('status', 'in', STATUTS_RDV_ECARTES)
      .gte('scheduled_date', depuis)
      .order('id')),
    toutLire(() => supabase
      .from('majordhome_lead_pennylane_quotes')
      .select('id, lead_id, quote_date, quote_amount_ht')
      .eq('org_id', orgId)
      .is('ejected_at', null)
      .gte('quote_date', depuis)
      .order('id')),
  ]);

  const devis = devisBruts.map((d) => ({ lead_id: d.lead_id, quote_date: d.quote_date, amount_ht: d.quote_amount_ht }));
  return { leads, cards, rdvs, devis };
}

export const pipelineDashboardService = {
  /** @returns {Promise<{ data: { leads, cards, rdvs, devis } | null, error: Error | null }>} */
  getData: (orgId, depuis) => withErrorHandling(() => lireDonnees(orgId, depuis), 'pipelineDashboard.getData'),
};
