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
import { approsRecues, refusReculChantier, STATUTS_AMONT_PLANIFICATION } from '@/lib/installOrder';
import { formatDateForInput } from '@/lib/utils';
import { fetchAllPages } from '@/lib/postgrestUtils';
import { CAMPAGNE_AVIS_POSE } from '@/lib/chantierApresVente';

// ============================================================================
// CONSTANTES
// ============================================================================

// `hint` : ce que l'étape veut dire, affiché sous le titre de la colonne (Eric 2026-11-17).
export const CHANTIER_STATUSES = [
  { value: 'gagne', label: 'Gagné', hint: 'Devis signé', color: '#10B981', display_order: 1 },
  { value: 'commande_a_faire', label: 'Commande à faire', hint: 'Acompte versé, à commander', color: '#F59E0B', display_order: 2 },
  { value: 'commande_recue', label: 'À planifier', hint: 'Commandes reçues, pose à dater', color: '#3B82F6', display_order: 3 },
  { value: 'planification', label: 'Planifié', hint: 'Pose au planning', color: '#8B5CF6', display_order: 4 },
  { value: 'realise', label: 'Réceptionné', hint: 'Pose terminée et réceptionnée', color: '#6B7280', display_order: 5 },
  { value: 'facture', label: 'Facturé', hint: 'Facture émise', color: '#0D9488', display_order: 6 },
];

export const ORDER_STATUSES = [
  { value: 'na', label: 'N/A' },
  { value: 'commande', label: 'Commandé' },
  { value: 'recu', label: 'Reçu' },
];

/**
 * Transitions autorisées entre statuts chantier (boutons du pied de la fiche).
 * « Planifié » n'est pas un geste manuel : la carte y entre quand un RDV
 * d'installation est posé (`syncCardStateOnCreate`) et en ressort quand le dernier
 * est annulé — le bouton « Planification → » depuis « À planifier » déplaçait la
 * carte sans RDV (CHABBERT, GAYRAN, 2026-10-27).
 * Les retours vers l'amont sont refusés par `updateChantierStatus` tant qu'une pose
 * à venir est au planning (`refusReculChantier`, DJAFOUR 2026-11-02).
 */
export const CHANTIER_TRANSITIONS = {
  gagne: ['commande_a_faire'],
  commande_a_faire: ['commande_recue', 'gagne'],
  commande_recue: ['commande_a_faire'],
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

/**
 * Garde du recul d'un chantier : une pose à venir au planning le retient (règle pure
 * `refusReculChantier`). Lecture des RDV en échec ⇒ refus aussi : on ne devine pas.
 * L'erreur porte `code = 'pose_a_venir'` et un message à afficher tel quel.
 */
async function verifierRecul(chantierId, newStatus) {
  if (!STATUTS_AMONT_PLANIFICATION.includes(newStatus)) return;
  const aujourdhui = formatDateForInput(new Date());
  const { data, error } = await supabase
    .from('majordhome_appointments')
    .select('scheduled_date, status')
    .eq('chantier_id', chantierId)
    .eq('appointment_type', 'installation')
    .gte('scheduled_date', aujourdhui);
  if (error) throw error;
  const refus = refusReculChantier(newStatus, data, aujourdhui);
  if (!refus) return;
  const err = new Error(refus);
  err.code = 'pose_a_venir';
  throw err;
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

  /**
   * Listes de l'après-vente : contrats (par client) et demandes d'avis après pose déjà
   * parties. Lues en entier, page par page : un filtre sur les clients des chantiers
   * grossirait avec le board, et une liste tronquée rouvrirait l'envoi du SMS.
   * @returns {Promise<{ data: { contrats: Object[], avis: Object[] } | null, error: Error | null }>}
   */
  async getApresVente(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[chantiers] orgId requis');
      const [contrats, avis] = await Promise.all([
        fetchAllPages((from, to) => supabase
          .from('majordhome_contracts').select('id, client_id, status, workflow_status')
          .eq('org_id', orgId).order('id').range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('majordhome_sms_logs').select('id, client_id')
          .eq('org_id', orgId).eq('campaign_name', CAMPAGNE_AVIS_POSE).neq('status', 'failed')
          .order('id').range(from, to)),
      ]);
      return { contrats, avis };
    }, 'chantiers.getApresVente');
  },

  async updateChantierStatus(orgId, chantierId, newStatus) {
    const validStatuses = CHANTIER_STATUSES.map((s) => s.value);
    if (!validStatuses.includes(newStatus)) throw new Error(`[chantiers] Statut invalide: ${newStatus}`);
    return withErrorHandling(async () => {
      await verifierRecul(chantierId, newStatus);
      const patch = { chantier_status: newStatus };
      if (newStatus === 'planification') patch.planification_date = new Date().toISOString().split('T')[0];
      return patchChantier(orgId, chantierId, patch);
    }, 'chantiers.updateChantierStatus');
  },

  /**
   * Appros (équipement / matériaux) + transition automatique du chantier.
   * Appros closes (`approsRecues`, N/A = réponse qualifiée) depuis « Commande à
   * faire » → « À planifier », ou directement « Planifié » si un RDV
   * d'installation existe (`hasActiveRdv`, filet : depuis le 2026-10-07 le RDV
   * seul y place déjà la carte via `syncCardStateOnCreate`).
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
  updateEquipmentType: (orgId, chantierId, equipmentTypeId) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { equipment_type_id: equipmentTypeId || null }), 'chantiers.updateEquipmentType'),
  updatePlannedOrder: (orgId, chantierId, { teamSize, days }) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { planned_team_size: teamSize ?? null, planned_days: days ?? null }), 'chantiers.updatePlannedOrder'),

  async uploadPvReception(orgId, chantierId, file) {
    if (!chantierId || !file) throw new Error('[chantiers] chantierId et file requis');
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    // Le premier segment est l'organisation : la règle du bucket le compare à l'adhésion de l'utilisateur.
    const storagePath = `${orgId}/pv-reception/${chantierId}/PV_Reception_${Date.now()}.${ext}`;
    const { error: uploadError } = await storageService.uploadFile('interventions', storagePath, file, { upsert: true, contentType: file.type });
    if (uploadError) return { data: null, error: uploadError };
    return withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.uploadPvReception');
  },
  updatePvReceptionPath: (orgId, chantierId, storagePath) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.updatePvReceptionPath'),
  updatePvLeveePath: (orgId, chantierId, storagePath) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { pv_levee_path: storagePath }), 'chantiers.updatePvLeveePath'),
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
