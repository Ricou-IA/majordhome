/**
 * chantiers.service.js - Majord'home Artisan
 * ============================================================================
 * Un chantier = une commande à exécuter (table majordhome.chantiers).
 * Lectures : vue majordhome_chantiers (id = chantier). Écritures : vue miroir
 * majordhome_chantiers_write (RLS role_can) ; gestes par RPC.
 *
 * @version 2.0.0 - chantier = entité (un devis validé = un chantier)
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { storageService } from '@services/storage.service';
import { approsRecues } from '@/lib/installOrder';

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
  facture: [],
};

// ============================================================================
// HELPERS
// ============================================================================

export function getChantierStatusConfig(status) {
  return CHANTIER_STATUSES.find(s => s.value === status) || CHANTIER_STATUSES[0];
}

/**
 * Montant d'affichage d'un chantier (carte Kanban, total colonne, modal).
 * Les devis validés dans Pennylane font foi — même définition que la carte
 * Gagné du pipeline (majordhome.lead_quote_stats).
 * `linked_quotes_amount_ht` vaut 0 aussi bien pour « aucun devis validé » que
 * pour « aucun devis rattaché » : seul validated_quotes_count les distingue,
 * d'où le branchement explicite plutôt qu'une cascade ||.
 */
/**
 * Date portée par la carte kanban (puce gauche + tri des colonnes), ISO 'YYYY-MM-DD' ou null :
 * Réceptionné / Facturé → date de réalisation figée (`realized_date`, 20261001_2) ;
 * sinon RDV d'installation actif à venir ; sinon date de signature.
 */
export function getChantierCardDate(chantier) {
  if (!chantier) return null;
  if (['realise', 'facture'].includes(chantier.chantier_status) && chantier.realized_date) return chantier.realized_date;
  if (chantier.has_active_rdv && chantier.next_rdv_date) return chantier.next_rdv_date;
  return chantier.won_date || null;
}

export function getChantierAmount(chantier) {
  if (!chantier) return 0;
  if (Number(chantier.validated_quotes_count) > 0) {
    return Number(chantier.linked_quotes_amount_ht) || 0;
  }
  return Number(chantier.order_amount_ht) || Number(chantier.estimated_revenue) || 0;
}


// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

/**
 * Patch d'un chantier par la vue miroir updatable. `.eq('org_id')` = défense en profondeur ;
 * 0 ligne renvoyée = chantier inconnu OU RLS refusée → on le DIT (jamais de succès silencieux).
 */
async function patchChantier(orgId, chantierId, patch) {
  if (!orgId) throw new Error('[chantiers] orgId requis');
  if (!chantierId) throw new Error('[chantiers] chantierId requis');
  const { data, error } = await supabase
    .from('majordhome_chantiers_write')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', chantierId)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('[chantiers] chantier introuvable ou modification refusée');
  return data;
}

async function rpc(name, params, label) {
  return withErrorHandling(async () => {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw error;
    return data;
  }, label);
}

export const chantiersService = {
  async getChantiers({ orgId, limit = 200 }) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[chantiers] orgId requis');
      const { data, error } = await supabase
        .from('majordhome_chantiers').select('*').eq('org_id', orgId)
        .order('won_date', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiers');
  },

  /** Tous les chantiers d'un client (un client peut en porter plusieurs). */
  async getChantiersByClientId(clientId) {
    if (!clientId) return { data: [], error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_chantiers').select('*').eq('client_id', clientId)
        .order('won_date', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiersByClientId');
  },

  async updateChantierStatus(orgId, chantierId, newStatus) {
    const validStatuses = CHANTIER_STATUSES.map((s) => s.value);
    if (!validStatuses.includes(newStatus)) throw new Error(`[chantiers] Statut invalide: ${newStatus}`);
    return withErrorHandling(async () => {
      const patch = { chantier_status: newStatus };
      if (newStatus === 'planification') patch.planification_date = new Date().toISOString().split('T')[0];
      return patchChantier(orgId, chantierId, patch);
    }, 'chantiers.updateChantierStatus');
  },

  /**
   * Appros (équipement / matériaux) + transition automatique du chantier.
   * Appros closes (`approsRecues`, N/A = réponse qualifiée) depuis « Commande à
   * faire » → « À planifier », ou directement « Planification » si une pose
   * provisoire est déjà posée (`hasActiveRdv`) : la carte ne bouge qu'une fois
   * les appros reçues, le RDV seul ne la déplace pas (règle 2026-10-01).
   * Retour : `{ data, error, autoTransitioned, newChantierStatus }`.
   */
  async updateOrderStatus(orgId, chantierId, { equipmentOrderStatus, materialsOrderStatus, currentChantierStatus, hasActiveRdv = false }) {
    const patch = {};
    if (equipmentOrderStatus !== undefined) patch.equipment_order_status = equipmentOrderStatus;
    if (materialsOrderStatus !== undefined) patch.materials_order_status = materialsOrderStatus;
    const allReceived = approsRecues(equipmentOrderStatus, materialsOrderStatus);
    let newChantierStatus = null;
    if (currentChantierStatus === 'commande_a_faire' && allReceived) {
      newChantierStatus = hasActiveRdv ? 'planification' : 'commande_recue';
    } else if (currentChantierStatus === 'commande_recue' && !allReceived) {
      newChantierStatus = 'commande_a_faire';
    }
    if (newChantierStatus) {
      patch.chantier_status = newChantierStatus;
      if (newChantierStatus === 'planification') patch.planification_date = new Date().toISOString().split('T')[0];
    }
    const result = await withErrorHandling(() => patchChantier(orgId, chantierId, patch), 'chantiers.updateOrderStatus');
    return { ...result, autoTransitioned: Boolean(newChantierStatus), newChantierStatus };
  },

  updateChantierNotes: (orgId, chantierId, notes) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { chantier_notes: notes || null }), 'chantiers.updateChantierNotes'),
  updateLabel: (orgId, chantierId, label) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { label: (label || '').trim() || null }), 'chantiers.updateLabel'),
  updatePlannedOrder: (orgId, chantierId, { teamSize, days }) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { planned_team_size: teamSize ?? null, planned_days: days ?? null }), 'chantiers.updatePlannedOrder'),

  async uploadPvReception(orgId, chantierId, file) {
    if (!chantierId || !file) throw new Error('[chantiers] chantierId et file requis');
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const storagePath = `pv-reception/${chantierId}/PV_Reception_${Date.now()}.${ext}`;
    const { error: uploadError } = await storageService.uploadFile('interventions', storagePath, file, { upsert: true, contentType: file.type });
    if (uploadError) return { data: null, error: uploadError };
    return withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.uploadPvReception');
  },
  updatePvReceptionPath: (orgId, chantierId, storagePath) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.updatePvReceptionPath'),
  async getPvReceptionUrl(pdfPath) {
    if (!pdfPath) return { url: null, error: null };
    return storageService.getSignedUrl('interventions', pdfPath);
  },

  // ── Gestes (RPC SECURITY DEFINER, garde role_can chantiers.edit côté base) ──
  ensureChantierForLead: (leadId) => rpc('chantier_ensure_for_lead', { p_lead_id: leadId }, 'chantiers.ensureChantierForLead'),
  groupChantiers: (targetId, sourceIds) => rpc('chantier_group', { p_target_id: targetId, p_source_ids: sourceIds }, 'chantiers.groupChantiers'),
  detachChantier: ({ chantierId, quoteIds, appointmentIds = [], movePlannedOrder = false, label = null }) =>
    rpc('chantier_detach', { p_chantier_id: chantierId, p_quote_ids: quoteIds, p_appointment_ids: appointmentIds, p_move_planned_order: movePlannedOrder, p_label: label }, 'chantiers.detachChantier'),
  deleteChantier: (chantierId) => rpc('chantier_delete', { p_chantier_id: chantierId }, 'chantiers.deleteChantier'),
};

export default chantiersService;
