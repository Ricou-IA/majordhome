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
  // Posé par le checkout du site ; le webhook Stripe passe la commande en « Nouvelle » au paiement.
  { value: 'en_attente_paiement', label: 'En attente de paiement', color: 'bg-slate-100 text-slate-600 border-slate-200' },
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
  // Statut inconnu : affiché tel quel, jamais déguisé en un autre statut.
  return WEBSHOP_ORDER_STATUSES.find((s) => s.value === value)
    || { value, label: value || '—', color: 'bg-gray-100 text-gray-600 border-gray-200' };
}

/** Résumé des lignes d'une commande : « Pellets ×2, Serviteur ×1 », ou l'ancien produit unique. */
export function orderLinesSummary(order) {
  if (order?.items?.length) return order.items.map((i) => `${i.product_name} × ${i.qty}`).join(', ');
  return `${order?.product_name || order?.product_slug || 'Produit'} × ${order?.quantity ?? 1}`;
}

// ============================================================================
// SERVICE
// ============================================================================

export const webshopService = {
  // ==========================================================================
  // COMMANDES
  // ==========================================================================

  /**
   * Liste des commandes (vue enrichie : product_name, lead_name) + leurs lignes
   * (`webshop_order_items`, commandes boutique à N produits) fusionnées en `order.items`.
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
      const orders = data || [];
      if (orders.length === 0) return orders;

      const { data: items, error: itemsError } = await supabase
        .from('majordhome_webshop_order_items')
        .select('order_id, product_name, qty, unit_price_ttc_cents, line_total_ttc_cents')
        .in('order_id', orders.map((o) => o.id));
      if (itemsError) throw itemsError;
      return orders.map((o) => ({ ...o, items: (items || []).filter((i) => i.order_id === o.id) }));
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
