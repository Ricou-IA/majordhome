/** OrderCard — carte kanban d'une commande boutique. */
import { AlertTriangle } from 'lucide-react';
import { orderLines, linesSummary, orderTotalCents, orderBadges, formatCents } from '@/lib/webshop/orders';

const TONES = {
  neutral: 'bg-secondary-100 text-secondary-600',
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-800',
};

export default function OrderCard({ order }) {
  const lines = orderLines(order);
  const badges = orderBadges(order, lines);
  const created = new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const client = [order.first_name, order.last_name].filter(Boolean).join(' ') || order.company_name || '—';
  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-3 shadow-sm hover:shadow transition-shadow space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-mono text-secondary-500">{order.order_number}</span>
        <span className="text-xs text-secondary-400">{created}</span>
      </div>
      <p className="text-sm font-medium text-secondary-900 truncate">
        {client}
        {order.city && <span className="font-normal text-secondary-500"> · {order.city}</span>}
      </p>
      <p className="text-xs text-secondary-600 line-clamp-2">{linesSummary(lines) || 'Aucun article'}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {badges.map((b) => (
            <span key={b.key} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${TONES[b.tone]}`}>
              {b.tone === 'warning' && <AlertTriangle className="w-3 h-3" />}
              {b.label}
            </span>
          ))}
        </div>
        <span className="text-sm font-semibold text-secondary-900 shrink-0">{formatCents(orderTotalCents(order))}</span>
      </div>
    </div>
  );
}
