/**
 * chantierReceptions.service.js — Majord'home Artisan
 * ============================================================================
 * Service de gestion des réceptions de marchandise sur les chantiers.
 *
 * Une réception = 1 ligne du devis Pennylane (snapshot) + qty reçue ce coup-ci.
 * Plusieurs réceptions par ligne pour gérer les livraisons échelonnées.
 *
 * Toutes les écritures passent par des RPC SECURITY DEFINER côté DB :
 *   - chantier_reception_create : INSERT + validation qty
 *   - chantier_reception_delete : DELETE
 *   - chantier_recompute_order_status : recalcule chantier_status
 *
 * @version 1.0.0
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const chantierReceptionsService = {
  /**
   * Récupère toutes les réceptions d'un chantier (ordre desc par date de création).
   * @param {string} chantierId — UUID du lead/chantier
   * @returns {Promise<Array>}
   */
  async getByChantier(chantierId) {
    return withErrorHandling(async () => {
      if (!chantierId) return [];
      const { data, error } = await supabase
        .from('majordhome_chantier_line_receptions')
        .select('*')
        .eq('chantier_id', chantierId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'chantierReceptions.getByChantier');
  },

  /**
   * Crée une réception via la RPC chantier_reception_create.
   * La RPC valide que (qty_received + sum existing) <= line_quantity_total.
   *
   * @param {Object} payload
   * @param {string} payload.chantierId
   * @param {number} payload.pennylaneQuoteId
   * @param {number} payload.pennylaneLineId
   * @param {string} payload.lineLabel
   * @param {number} payload.lineUnitPriceHt
   * @param {number} payload.lineVatRate
   * @param {number} payload.lineQuantityTotal
   * @param {number} payload.quantityReceived
   * @param {string} [payload.receivedAt] — ISO date (défaut today côté DB)
   * @param {string} [payload.notes]
   * @returns {Promise<Object>} — la row insérée
   */
  async create(payload) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('chantier_reception_create', {
        p_chantier_id: payload.chantierId,
        p_pennylane_quote_id: payload.pennylaneQuoteId,
        p_pennylane_line_id: payload.pennylaneLineId,
        p_line_label: payload.lineLabel,
        p_line_unit_price_ht: payload.lineUnitPriceHt,
        p_line_vat_rate: payload.lineVatRate,
        p_line_quantity_total: payload.lineQuantityTotal,
        p_quantity_received: payload.quantityReceived,
        p_received_at: payload.receivedAt || null,
        p_notes: payload.notes || null,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    }, 'chantierReceptions.create');
  },

  /**
   * Supprime une réception (RPC chantier_reception_delete).
   * @param {string} receptionId
   */
  async delete(receptionId) {
    return withErrorHandling(async () => {
      if (!receptionId) throw new Error('receptionId requis');
      const { error } = await supabase.rpc('chantier_reception_delete', {
        p_reception_id: receptionId,
      });
      if (error) throw error;
      return true;
    }, 'chantierReceptions.delete');
  },

  /**
   * Recalcule chantier_status en fonction des réceptions et du snapshot
   * des lignes attendues du devis Pennylane.
   *
   * @param {string} chantierId
   * @param {Array<{line_id: number, qty_total: number}>} expectedLines
   * @returns {Promise<string>} — nouveau statut (ou inchangé)
   */
  async recomputeStatus(chantierId, expectedLines) {
    return withErrorHandling(async () => {
      if (!chantierId) throw new Error('chantierId requis');
      const { data, error } = await supabase.rpc('chantier_recompute_order_status', {
        p_chantier_id: chantierId,
        p_expected_lines: expectedLines || [],
      });
      if (error) throw error;
      return data;
    }, 'chantierReceptions.recomputeStatus');
  },
};

export default chantierReceptionsService;
