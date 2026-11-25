/**
 * savProjet.service.js — une carte SAV reliée à un projet (lead)
 * ============================================================================
 * I/O seulement ; les règles sont dans src/lib/savProjet.js.
 * Le lien est `interventions.lead_id` (clé étrangère existante, `ON DELETE SET NULL`,
 * suivie par `lead_merge`). Rien d'autre n'est stocké : l'état du projet se LIT dans le
 * pipeline (chantiers du lead, cartes du kanban des leads).
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id), comme les leads et les chantiers.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

export const savProjetService = {
  /**
   * État du pipeline pour les leads reliés à des cartes SAV : leurs chantiers et leurs
   * cartes du kanban des leads. Une erreur est rendue (jamais des listes vides à la place :
   * « aucun chantier » ferait rester dans le SAV une demande déjà passée en chantier).
   * @param {{ orgId: string, leadIds: string[] }} params
   * @returns {Promise<{ data: { chantiers: Array, cartes: Array } | null, error: Error | null }>}
   */
  async getEtats({ orgId, leadIds }) {
    return withErrorHandling(async () => {
      if (!orgId || !leadIds?.length) return { chantiers: [], cartes: [] };
      const [chantiers, cartes] = await Promise.all([
        supabase.from('majordhome_chantiers').select('id, lead_id, chantier_status')
          .eq('org_id', orgId).in('lead_id', leadIds),
        supabase.from('majordhome_kanban_cards').select('lead_id, column_key')
          .eq('org_id', orgId).in('lead_id', leadIds),
      ]);
      if (chantiers.error) throw chantiers.error;
      if (cartes.error) throw cartes.error;
      return { chantiers: chantiers.data || [], cartes: cartes.data || [] };
    }, 'savProjet.getEtats');
  },

  /**
   * Customers Pennylane pontés à un client Majord'home (mapping `pennylane_sync`, souvent
   * absent pour un client créé directement dans Pennylane : l'appelant complète par le nom).
   * @param {{ orgId: string, clientId: string }} params
   * @returns {Promise<{ data: string[] | null, error: Error | null }>}
   */
  async getCustomerIds({ orgId, clientId }) {
    return withErrorHandling(async () => {
      if (!orgId || !clientId) return [];
      const { data, error } = await supabase
        .from('majordhome_pennylane_sync')
        .select('pennylane_id')
        .eq('org_id', orgId)
        .eq('entity_type', 'client')
        .eq('local_id', clientId);
      if (error) throw error;
      return (data || []).map((ligne) => String(ligne.pennylane_id)).filter(Boolean);
    }, 'savProjet.getCustomerIds');
  },

  /**
   * Relie (ou délie, `leadId` null) une carte SAV à un lead. Rend une erreur si aucune ligne
   * n'est écrite (droits) : un lien annoncé mais absent laisserait la demande sans suite.
   * @param {{ interventionId: string, leadId: (string|null) }} params
   * @returns {Promise<{ data: { id: string, lead_id: (string|null) } | null, error: Error | null }>}
   */
  async lier({ interventionId, leadId }) {
    return withErrorHandling(async () => {
      if (!interventionId) throw new Error('[savProjet] interventionId requis');
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ lead_id: leadId || null })
        .eq('id', interventionId)
        .select('id, lead_id');
      if (error) throw error;
      if (!data?.length) throw new Error('La carte SAV n’a pas pu être reliée au projet');
      return data[0];
    }, 'savProjet.lier');
  },
};

export default savProjetService;
