/**
 * orders.js — Webshop : logique PURE des commandes (kanban, lignes, pastilles).
 * Testé : node --test scripts/webshop-orders.test.mjs
 */

export const ORDER_STATUS_LABELS = {
  en_attente_paiement: 'En attente de paiement',
  nouvelle: 'Nouvelle',
  confirmee: 'Confirmée',
  transmise_fournisseur: 'Transmise fournisseur',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export const ORDER_BOARD_COLUMNS = [
  { id: 'nouvelle', label: 'Nouvelle', color: '#3b82f6' },
  { id: 'confirmee', label: 'Confirmée', color: '#6366f1' },
  { id: 'transmise_fournisseur', label: 'Transmise fournisseur', color: '#f59e0b' },
  { id: 'expediee', label: 'Expédiée', color: '#8b5cf6' },
  { id: 'livree', label: 'Livrée', color: '#0ea5e9' },
];

export const ORDER_SIDE_STATUSES = ['en_attente_paiement', 'annulee'];

const BOARD_IDS = new Set(ORDER_BOARD_COLUMNS.map((c) => c.id));

export function canMoveTo(from, to) {
  return BOARD_IDS.has(from) && BOARD_IDS.has(to) && from !== to;
}

export function toCents(n) {
  if (n === null || n === undefined || n === '') return null;
  return Math.round(Number(n) * 100);
}

export function formatCents(cents) {
  const euros = (Number(cents) || 0) / 100;
  const hasDecimals = Math.round(euros * 100) % 100 !== 0;
  return euros.toLocaleString('fr-FR', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }) + ' €';
}

/** Lignes de commande ; repli sur le produit unique de l'ancien modèle borne. */
export function orderLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length > 0) {
    return items.map((it) => ({
      name: it.product_name,
      qty: it.qty,
      unitCents: it.unit_price_ttc_cents,
      totalCents: it.line_total_ttc_cents,
      shippingKind: it.shipping_kind ?? null,
    }));
  }
  if (order?.product_id || order?.product_name) {
    const qty = order.quantity ?? 1;
    return [{
      name: order.product_name ?? 'Produit',
      qty,
      unitCents: toCents(order.unit_price_ttc),
      totalCents: toCents(order.total_ttc) ?? (toCents(order.unit_price_ttc) ?? 0) * qty,
      shippingKind: null,
    }];
  }
  return [];
}

export function linesSummary(lines, max = 2) {
  const shown = lines.slice(0, max).map((l) => `${l.name} ×${l.qty}`).join(', ');
  return lines.length > max ? `${shown} +${lines.length - max}` : shown;
}

export function orderTotalCents(order) {
  if (order?.total_ttc_cents !== null && order?.total_ttc_cents !== undefined) return order.total_ttc_cents;
  return toCents(order?.total_ttc) ?? 0;
}

function shortDate(iso) {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
}

/** Pastilles de carte, ordre stable : livraison → canal → alertes. */
export function orderBadges(order, lines) {
  const badges = [];
  const hasPallet = lines.some((l) => l.shippingKind === 'pallet') || Boolean(order.pallet_delivery_mode);
  const hasParcel = lines.some((l) => l.shippingKind === 'parcel');
  if (hasPallet) {
    badges.push({ key: 'pallet', label: order.delivery_date ? `Palette · ${shortDate(order.delivery_date)}` : 'Palette', tone: 'info' });
  }
  if (hasParcel) badges.push({ key: 'parcel', label: 'Colis', tone: 'neutral' });
  if (order.pallet_delivery_mode === 'pickup' || order.parcel_delivery_mode === 'pickup') {
    badges.push({ key: 'pickup', label: order.pickup_point_name ? `Retrait · ${order.pickup_point_name}` : 'Retrait', tone: 'neutral' });
  }
  if (order.channel === 'pro') badges.push({ key: 'pro', label: 'Pro', tone: 'neutral' });
  if (order.order_type === 'vente_installation') badges.push({ key: 'install', label: 'Installation', tone: 'info' });
  if (order.needs_manual_planning) badges.push({ key: 'manual_planning', label: 'Planification manuelle', tone: 'warning' });
  if (order.delivery_slot_changed) badges.push({ key: 'slot_changed', label: 'Créneau modifié', tone: 'warning' });
  return badges;
}

/** Patch d'un changement de statut : shipped_at / delivered_at posés une seule fois. */
export function statusPatch(order, to, now = new Date()) {
  const patch = { status: to };
  if (to === 'expediee' && !order.shipped_at) patch.shipped_at = now.toISOString();
  if (to === 'livree' && !order.delivered_at) patch.delivered_at = now.toISOString();
  return patch;
}

/** Réactiver une commande annulée : jamais payée → retour en attente de paiement, motif effacé. */
export function reactivationPatch(order) {
  return { status: order.paid_at ? 'nouvelle' : 'en_attente_paiement', cancel_reason: null };
}

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesOrderSearch(order, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return [order.order_number, order.first_name, order.last_name, order.city, order.email, order.company_name]
    .some((v) => fold(v).includes(q));
}
