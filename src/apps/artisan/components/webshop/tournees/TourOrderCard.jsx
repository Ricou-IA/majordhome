/**
 * TourOrderCard.jsx — Une commande livrée par tournée : client, contact, adresse,
 * palettes, produits, commentaire de livraison, alertes ; action Déplacer / Planifier.
 */

import { Phone, MapPin, MessageSquare, AlertTriangle, ArrowRightLeft, ClipboardList } from 'lucide-react';
import { orderAddress, formatPhoneFR } from '@/lib/webshop/tournees';

export default function TourOrderCard({ order, items, canManage, onMove }) {
  const lines = (items || []).filter((i) => i.order_id === order.id);
  return (
    <div className="border border-secondary-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-secondary-900">
            {order.first_name} {order.last_name}
            <span className="ml-2 text-xs font-normal text-secondary-400">{order.order_number}</span>
          </p>
          {order.phone && (
            <a href={`tel:${order.phone}`} className="mt-0.5 text-sm text-secondary-600 hover:text-primary-600 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> {formatPhoneFR(order.phone)}
            </a>
          )}
          <p className="mt-0.5 text-sm text-secondary-600 flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {orderAddress(order) || '—'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-secondary-900 tabular-nums">
            {order.pallet_slots} pal.
          </p>
          {canManage && onMove && (
            <button
              type="button"
              onClick={() => onMove(order)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-800"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {order.delivery_slot_id ? 'Déplacer' : 'Planifier'}
            </button>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <ul className="mt-2 text-sm text-secondary-700 space-y-0.5">
          {lines.map((l, i) => (
            <li key={i}>
              {l.product_name} <span className="text-secondary-400">× {l.qty}</span>
              {l.shipping_kind !== 'pallet' && <span className="ml-1 text-xs text-secondary-400">(colis)</span>}
            </li>
          ))}
        </ul>
      )}

      {order.comments && (
        <p className="mt-2 text-sm text-secondary-700 bg-secondary-50 rounded px-2 py-1 flex items-start gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-secondary-400" /> {order.comments}
        </p>
      )}

      {order.delivery_instructions && (
        <p className="mt-2 text-sm font-medium text-amber-900 bg-amber-50 rounded px-2 py-1 flex items-start gap-1.5">
          <ClipboardList className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Consigne : {order.delivery_instructions}
        </p>
      )}

      {(order.delivery_slot_changed || order.needs_manual_planning) && (
        <p className="mt-2 text-xs text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {order.needs_manual_planning ? 'À planifier manuellement' : 'Tournée différente de celle choisie par le client'}
        </p>
      )}
    </div>
  );
}
