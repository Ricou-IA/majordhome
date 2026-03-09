/**
 * chantiers.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des chantiers (workflow post-vente).
 *
 * Un chantier = un lead gagné suivi dans le Kanban chantiers.
 * Utilise la vue publique majordhome_chantiers pour les lectures.
 * Utilise la RPC update_majordhome_lead pour les écritures.
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { leadsService } from '@/shared/services/leads.service';

// ============================================================================
// CONSTANTES
// ============================================================================

export const CHANTIER_STATUSES = [
  { value: 'gagne', label: 'Gagné', color: '#10B981', display_order: 1 },
  { value: 'commande_a_faire', label: 'Commande à faire', color: '#F59E0B', display_order: 2 },
  { value: 'commande_recue', label: 'À planifier', color: '#3B82F6', display_order: 3 },
  { value: 'planification', label: 'Planification', color: '#8B5CF6', display_order: 4 },
  { value: 'realise', label: 'Réalisé', color: '#6B7280', display_order: 5 },
  { value: 'facture', label: 'Facturé', color: '#0D9488', display_order: 6 },
];

export const ORDER_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'commande', label: 'Commandé' },
  { value: 'recu', label: 'Reçu' },
];

/**
 * Transitions autorisées entre statuts chantier
 */
export const CHANTIER_TRANSITIONS = {
  gagne: ['commande_a_faire'],
  commande_a_faire: ['commande_recue', 'gagne'],
  commande_recue: ['planification', 'commande_a_faire'],
  planification: ['realise', 'commande_recue'],
  realise: ['facture'],
  facture: ['archive'],
};

// ============================================================================
// HELPERS
// ============================================================================

export function getChantierStatusConfig(status) {
  return CHANTIER_STATUSES.find(s => s.value === status) || CHANTIER_STATUSES[0];
}

function shouldAutoTransitionToCommandeRecue(equipmentStatus, materialsStatus) {
  const valid = ['recu', 'na'];
  return valid.includes(equipmentStatus) && valid.includes(materialsStatus);
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const chantiersService = {
  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * Récupère tous les chantiers d'une organisation (vue majordhome_chantiers)
   */
  async getChantiers({ orgId, limit = 200 }) {
    if (!orgId) throw new Error('[chantiers] orgId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('org_id', orgId)
        .order('won_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[chantiers] getChantiers error:', error);
        return { data: null, error };
      }

      return { data: data || [], error: null };
    } catch (err) {
      console.error('[chantiers] getChantiers error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupère le chantier lié à un client (via lead.client_id)
   */
  async getChantierByClientId(clientId) {
    if (!clientId) return { data: null, error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('client_id', clientId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[chantiers] getChantierByClientId error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[chantiers] getChantierByClientId error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // MUTATIONS
  // ==========================================================================

  /**
   * Met à jour le statut chantier d'un lead
   */
  async updateChantierStatus(leadId, newStatus) {
    if (!leadId || !newStatus) throw new Error('[chantiers] leadId et newStatus requis');

    const validStatuses = CHANTIER_STATUSES.map(s => s.value);
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`[chantiers] Statut invalide: ${newStatus}`);
    }

    try {
      const updates = { chantier_status: newStatus };

      // Auto-set planification_date au passage en planification
      if (newStatus === 'planification') {
        updates.planification_date = new Date().toISOString().split('T')[0];
      }

      const result = await leadsService.updateLead(leadId, updates);

      if (result.error) {
        console.error('[chantiers] updateChantierStatus error:', result.error);
      }

      return result;
    } catch (err) {
      console.error('[chantiers] updateChantierStatus error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Met à jour les statuts commande (équipement + matériaux)
   * Auto-transition vers commande_recue si conditions remplies
   */
  async updateOrderStatus(leadId, { equipmentOrderStatus, materialsOrderStatus, currentChantierStatus }) {
    if (!leadId) throw new Error('[chantiers] leadId requis');

    try {
      const updates = {};

      if (equipmentOrderStatus !== undefined) {
        updates.equipment_order_status = equipmentOrderStatus;
      }
      if (materialsOrderStatus !== undefined) {
        updates.materials_order_status = materialsOrderStatus;
      }

      // Auto-transitions basées sur l'état des commandes
      const effectiveEquip = equipmentOrderStatus ?? null;
      const effectiveMat = materialsOrderStatus ?? null;
      let autoTransitioned = false;

      const allReceived = effectiveEquip && effectiveMat &&
        shouldAutoTransitionToCommandeRecue(effectiveEquip, effectiveMat);

      if (currentChantierStatus === 'commande_a_faire' && allReceived) {
        // Forward : commande_a_faire → commande_recue
        updates.chantier_status = 'commande_recue';
        autoTransitioned = true;
      } else if (currentChantierStatus === 'commande_recue' && !allReceived) {
        // Retour arrière : commande_recue → commande_a_faire
        updates.chantier_status = 'commande_a_faire';
        autoTransitioned = true;
      }

      const result = await leadsService.updateLead(leadId, updates);

      return { ...result, autoTransitioned };
    } catch (err) {
      console.error('[chantiers] updateOrderStatus error:', err);
      return { data: null, error: err, autoTransitioned: false };
    }
  },

  /**
   * Met à jour la date estimative
   */
  async updateEstimatedDate(leadId, estimatedDate) {
    if (!leadId) throw new Error('[chantiers] leadId requis');

    return leadsService.updateLead(leadId, {
      estimated_date: estimatedDate || null,
    });
  },

  /**
   * Met à jour les notes chantier
   */
  async updateChantierNotes(leadId, notes) {
    if (!leadId) throw new Error('[chantiers] leadId requis');

    return leadsService.updateLead(leadId, {
      chantier_notes: notes || null,
    });
  },
};

export default chantiersService;
