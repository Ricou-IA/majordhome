/**
 * webshop.service.js - Majord'home Artisan
 * ============================================================================
 * Module Webshop : commandes du site web (drop shipping) + catalogue produits.
 *
 * Première utilisation : bornes de recharge IRVE (V2C Trydan). Toutes les
 * ventes du site (vente directe à expédier) transitent par ce module ; les
 * ventes + installation arrivent en plus dans le pipeline (lead lié via
 * lead_id, statut « À planifier » pour les commandes concessionnaires).
 *
 * Lectures : vue enrichie majordhome_webshop_orders (JOIN produit + lead)
 * Écritures : vues auto-updatable majordhome_webshop_orders_write
 *             et majordhome_webshop_products
 *
 * @version 1.0.0 - Création du module (2026-06-12)
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

// ============================================================================
// CONSTANTES
// ============================================================================

/** Statuts du cycle drop shipping (CHECK majordhome.webshop_orders.status) */
export const WEBSHOP_ORDER_STATUSES = [
  { value: 'nouvelle', label: 'Nouvelle', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'confirmee', label: 'Confirmée', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { value: 'transmise_fournisseur', label: 'Transmise fournisseur', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'expediee', label: 'Expédiée', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { value: 'livree', label: 'Livrée', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'annulee', label: 'Annulée', color: 'bg-gray-100 text-gray-500 border-gray-200' },
];

export const WEBSHOP_CHANNELS = [
  { value: 'particulier', label: 'Particulier', color: 'bg-sky-100 text-sky-700' },
  { value: 'pro', label: 'Pro / concessionnaire', color: 'bg-slate-200 text-slate-700' },
];

export const WEBSHOP_ORDER_TYPES = [
  { value: 'vente_directe', label: 'Vente directe (expédition)', color: 'bg-orange-100 text-orange-700' },
  { value: 'vente_installation', label: 'Vente + installation', color: 'bg-emerald-100 text-emerald-700' },
];

export function getStatusMeta(value) {
  return WEBSHOP_ORDER_STATUSES.find((s) => s.value === value) || WEBSHOP_ORDER_STATUSES[0];
}

// ============================================================================
// SERVICE
// ============================================================================

export const webshopService = {
  // ==========================================================================
  // COMMANDES
  // ==========================================================================

  /**
   * Liste des commandes (vue enrichie : product_name, lead_name).
   * @param {object} [filters]
   * @param {string} [filters.status] - filtre statut exact
   * @param {string} [filters.channel] - 'particulier' | 'pro'
   */
  async getOrders(filters = {}) {
    return withErrorHandling(async () => {
      let query = supabase
        .from('majordhome_webshop_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.status) query = query.eq('status', filters.status);
      if (filters.channel) query = query.eq('channel', filters.channel);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }, 'webshop.getOrders');
  },

  /**
   * Mise à jour d'une commande (statut, transporteur, n° suivi, notes).
   * Pose automatiquement shipped_at / delivered_at lors des transitions.
   * @param {string} orderId
   * @param {object} updates
   */
  async updateOrder(orderId, updates) {
    return withErrorHandling(async () => {
      if (!orderId) throw new Error('[webshopService] orderId requis');

      const payload = { ...updates };
      if (updates.status === 'expediee' && !updates.shipped_at) {
        payload.shipped_at = new Date().toISOString();
      }
      if (updates.status === 'livree' && !updates.delivered_at) {
        payload.delivered_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('majordhome_webshop_orders_write')
        .update(payload)
        .eq('id', orderId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshop.updateOrder');
  },

  // ==========================================================================
  // PRODUITS / TARIFS
  // ==========================================================================

  /** Catalogue complet (actifs et inactifs — l'UI distingue). */
  async getProducts() {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'webshop.getProducts');
  },

  /**
   * Mise à jour d'un produit (tarifs affichés sur le site, activation).
   * Le site web lit ces valeurs en direct : la modification est immédiate.
   * @param {string} productId
   * @param {object} updates - { price_ttc, install_price_ttc, pro_install_price_ttc, is_active, ... }
   */
  async updateProduct(productId, updates) {
    return withErrorHandling(async () => {
      if (!productId) throw new Error('[webshopService] productId requis');
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .update(updates)
        .eq('id', productId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshop.updateProduct');
  },
};

export default webshopService;
