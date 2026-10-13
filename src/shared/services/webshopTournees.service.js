/**
 * webshopTournees.service.js - Majord'home Artisan
 * ============================================================================
 * Tournées de livraison palettes de la boutique (onglet Webshop → Tournées).
 *
 * Le moteur (créneaux, réservation au paiement, fermeture J-2, feuille de route
 * envoyée par le cron de 17 h) vit côté site. Ici :
 *   - lectures : vues majordhome_webshop_sectors / _delivery_slots /
 *     _orders_write (seule vue qui porte les colonnes livraison) / _order_items ;
 *   - gestes : RPC SECURITY DEFINER de 20261013_2 (team_leader+, garde en base).
 * Toutes les lectures filtrent explicitement org_id (org CORE, comme le site).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const SLOT_COLS = 'id, org_id, sector_id, delivery_date, status, capacity_slots, capacity_stops, used_slots, used_stops, closed_at, close_reason, route_sheet_sent_at, km_estimated, status_note, route_sheet_request_id, route_sheet_requested_at';
const ORDER_COLS = 'id, org_id, order_number, status, first_name, last_name, phone, email, address, postal_code, city, comments, internal_notes, delivery_instructions, geocoded_address, normalized_address, lat, lon, pallet_slots, pallet_delivery_mode, sector_id, requested_slot_id, delivery_slot_id, delivery_slot_changed, needs_manual_planning, paid_at, created_at, total_ttc_cents';
const ITEM_COLS = 'order_id, product_name, qty, shipping_kind, pallet_slots';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

async function itemsFor(orgId, orderIds) {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabase
    .from('majordhome_webshop_order_items')
    .select(ITEM_COLS)
    .eq('org_id', orgId)
    .in('order_id', orderIds);
  if (error) throw error;
  return data || [];
}

export const webshopTourneesService = {
  async getSectors(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_sectors')
        .select('id, code, label, depot, max_stops, max_km, is_active')
        .eq('org_id', orgId)
        .order('label');
      if (error) throw error;
      return data || [];
    }, 'webshopTournees.getSectors');
  },

  /** Tournées d'une plage de dates (incluses). */
  async getSlots(orgId, { from, to } = {}) {
    return withErrorHandling(async () => {
      let query = supabase
        .from('majordhome_webshop_delivery_slots')
        .select(SLOT_COLS)
        .eq('org_id', orgId)
        .order('delivery_date')
        .limit(1000);
      if (from) query = query.gte('delivery_date', from);
      if (to) query = query.lte('delivery_date', to);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }, 'webshopTournees.getSlots');
  },

  /** Commandes rattachées à une tournée (toutes, l'écran distingue payées / annulées) + leurs lignes. */
  async getSlotOrders(orgId, slotId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_orders_write')
        .select(ORDER_COLS)
        .eq('org_id', orgId)
        .eq('delivery_slot_id', slotId)
        .order('created_at');
      if (error) throw error;
      const orders = data || [];
      return { orders, items: await itemsFor(orgId, orders.map((o) => o.id)) };
    }, 'webshopTournees.getSlotOrders');
  },

  /** Commandes payées « à planifier manuellement » (aucune tournée trouvée au paiement, tournée annulée). */
  async getUnplannedOrders(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_orders_write')
        .select(ORDER_COLS)
        .eq('org_id', orgId)
        .eq('needs_manual_planning', true)
        .not('paid_at', 'is', null)
        .neq('status', 'annulee')
        .order('created_at');
      if (error) throw error;
      const orders = data || [];
      return { orders, items: await itemsFor(orgId, orders.map((o) => o.id)) };
    }, 'webshopTournees.getUnplannedOrders');
  },

  async setSlotStatus(slotId, status, note = null) {
    return withErrorHandling(
      () => rpc('webshop_slot_set_status', { p_slot_id: slotId, p_status: status, p_note: note }),
      'webshopTournees.setSlotStatus',
    );
  },

  async cancelSlot(slotId, note) {
    return withErrorHandling(() => rpc('webshop_slot_cancel', { p_slot_id: slotId, p_note: note }), 'webshopTournees.cancelSlot');
  },

  async moveOrder(orderId, targetSlotId) {
    return withErrorHandling(
      () => rpc('webshop_order_move_slot', { p_order_id: orderId, p_target_slot_id: targetSlotId }),
      'webshopTournees.moveOrder',
    );
  },

  /** Déclenche l'envoi de la feuille de route (pg_net → route du site). Asynchrone : suivre getSendResult. */
  async sendRouteSheet(slotId) {
    return withErrorHandling(() => rpc('webshop_slot_send_now', { p_slot_id: slotId }), 'webshopTournees.sendRouteSheet');
  },

  /** État du dernier envoi manuel : none | pending | sent | failed (+ code HTTP, erreurs de la tournée). */
  async getSendResult(slotId) {
    return withErrorHandling(() => rpc('webshop_slot_send_result', { p_slot_id: slotId }), 'webshopTournees.getSendResult');
  },
};

export default webshopTourneesService;
