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
import { withErrorHandling } from '@lib/serviceHelpers';
import { leadsService } from '@services/leads.service';
import { storageService } from '@services/storage.service';

// ============================================================================
// CONSTANTES
// ============================================================================

export const CHANTIER_STATUSES = [
  { value: 'gagne', label: 'Gagné', color: '#10B981', display_order: 1 },
  { value: 'commande_a_faire', label: 'Commande à faire', color: '#F59E0B', display_order: 2 },
  { value: 'commande_recue', label: 'À planifier', color: '#3B82F6', display_order: 3 },
  { value: 'planification', label: 'Planification', color: '#8B5CF6', display_order: 4 },
  { value: 'realise', label: 'Réceptionné', color: '#6B7280', display_order: 5 },
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
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[chantiers] orgId requis');
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('org_id', orgId)
        .order('won_date', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiers');
  },

  /**
   * Récupère le chantier lié à un client (via lead.client_id)
   */
  async getChantierByClientId(clientId) {
    if (!clientId) return { data: null, error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('client_id', clientId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'chantiers.getChantierByClientId');
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
    if (!validStatuses.includes(newStatus)) throw new Error(`[chantiers] Statut invalide: ${newStatus}`);

    return withErrorHandling(async () => {
      const updates = { chantier_status: newStatus };
      if (newStatus === 'planification') {
        updates.planification_date = new Date().toISOString().split('T')[0];
      }
      const result = await leadsService.updateLead(leadId, updates);
      if (result.error) throw result.error;
      return result.data;
    }, 'chantiers.updateChantierStatus');
  },

  /**
   * Met à jour les statuts commande (équipement + matériaux)
   * Auto-transition vers commande_recue si conditions remplies
   */
  async updateOrderStatus(leadId, { equipmentOrderStatus, materialsOrderStatus, currentChantierStatus }) {
    if (!leadId) throw new Error('[chantiers] leadId requis');

    const updates = {};
    if (equipmentOrderStatus !== undefined) updates.equipment_order_status = equipmentOrderStatus;
    if (materialsOrderStatus !== undefined) updates.materials_order_status = materialsOrderStatus;

    const effectiveEquip = equipmentOrderStatus ?? null;
    const effectiveMat = materialsOrderStatus ?? null;
    let autoTransitioned = false;

    const allReceived = effectiveEquip && effectiveMat &&
      shouldAutoTransitionToCommandeRecue(effectiveEquip, effectiveMat);

    if (currentChantierStatus === 'commande_a_faire' && allReceived) {
      updates.chantier_status = 'commande_recue';
      autoTransitioned = true;
    } else if (currentChantierStatus === 'commande_recue' && !allReceived) {
      updates.chantier_status = 'commande_a_faire';
      autoTransitioned = true;
    }

    const result = await leadsService.updateLead(leadId, updates);
    return { ...result, autoTransitioned };
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

  // ==========================================================================
  // PV DE RÉCEPTION
  // ==========================================================================

  /**
   * Upload le PV de réception et enregistre le chemin sur le lead
   */
  async uploadPvReception(leadId, file) {
    if (!leadId || !file) throw new Error('[chantiers] leadId et file requis');

    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const storagePath = `pv-reception/${leadId}/PV_Reception_${Date.now()}.${ext}`;

    const { error: uploadError } = await storageService.uploadFile(
      'interventions',
      storagePath,
      file,
      { upsert: true, contentType: file.type },
    );
    if (uploadError) return { data: null, error: uploadError };

    const result = await leadsService.updateLead(leadId, {
      pv_reception_path: storagePath,
    });
    return result;
  },

  /**
   * Met à jour uniquement le chemin PV (utilisé par la page de signature)
   */
  async updatePvReceptionPath(leadId, storagePath) {
    if (!leadId) throw new Error('[chantiers] leadId requis');
    return leadsService.updateLead(leadId, {
      pv_reception_path: storagePath,
    });
  },

  /**
   * Retourne une URL signée pour le PV de réception
   */
  async getPvReceptionUrl(pdfPath) {
    if (!pdfPath) return { url: null, error: null };
    return storageService.getSignedUrl('interventions', pdfPath);
  },
};

export default chantiersService;
