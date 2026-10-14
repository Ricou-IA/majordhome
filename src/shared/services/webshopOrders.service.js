/**
 * webshopOrders.service.js — Commandes boutique (kanban).
 * Lecture : vue majordhome_webshop_orders (+ créneau, secteur, point de retrait) puis lignes
 * majordhome_webshop_order_items fusionnées en mémoire (`order.items`).
 * Écriture : vue auto-updatable majordhome_webshop_orders_write ; suppression définitive
 * par la RPC webshop_order_hard_delete (org_admin, 20261013_3).
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const CHUNK = 200;

export const webshopOrdersService = {
  async getOrders(orgId) {
    return withErrorHandling(async () => {
      const { data: orders, error } = await supabase
        .from('majordhome_webshop_orders')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const ids = (orders || []).map((o) => o.id);
      const items = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error: itemsError } = await supabase
          .from('majordhome_webshop_order_items')
          .select('order_id, product_id, product_name, product_slug, supplier_ref, qty, unit_price_ttc_cents, vat_rate, shipping_kind, pallet_slots, line_total_ttc_cents')
          .eq('org_id', orgId)
          .in('order_id', ids.slice(i, i + CHUNK));
        if (itemsError) throw itemsError;
        items.push(...(data || []));
      }
      const byOrder = new Map();
      for (const it of items) {
        if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
        byOrder.get(it.order_id).push(it);
      }
      return (orders || []).map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
    }, 'webshopOrders.getOrders');
  },

  async updateOrder(orgId, orderId, patch) {
    return withErrorHandling(async () => {
      if (!orderId) throw new Error('[webshopOrders] orderId requis');
      const { data, error } = await supabase
        .from('majordhome_webshop_orders_write')
        .update(patch)
        .eq('id', orderId)
        .eq('org_id', orgId)
        .select('id, status, carrier, tracking_number, internal_notes, delivery_instructions, shipped_at, delivered_at, cancel_reason')
        .single();
      if (error) throw error;
      return data;
    }, 'webshopOrders.updateOrder');
  },

  /** Suppression définitive (org_admin) : lignes en cascade, tournée recomptée par trigger. */
  async deleteOrder(orderId) {
    return withErrorHandling(async () => {
      if (!orderId) throw new Error('[webshopOrders] orderId requis');
      const { data, error } = await supabase.rpc('webshop_order_hard_delete', { p_order_id: orderId });
      if (error) throw error;
      return data;
    }, 'webshopOrders.deleteOrder');
  },
};

export default webshopOrdersService;
