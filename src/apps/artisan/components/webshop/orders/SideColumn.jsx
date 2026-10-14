/** SideColumn — colonne repliée (En attente de paiement / Annulée) hors du tableau glissable. */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@/lib/webshop/orders';
import OrderCard from './OrderCard';

export default function SideColumn({ status, orders, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-secondary-200 rounded-xl bg-secondary-50">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-medium text-secondary-700">
          {ORDER_STATUS_LABELS[status]} <span className="text-secondary-400">({orders.length})</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-secondary-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-3 pt-0">
          {orders.length === 0 && <p className="text-xs text-secondary-400">Aucune commande.</p>}
          {orders.map((o) => (
            <div key={o.id} className="cursor-pointer" onClick={() => onOpen(o)}>
              <OrderCard order={o} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
