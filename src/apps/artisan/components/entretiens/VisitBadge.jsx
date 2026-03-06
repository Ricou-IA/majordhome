/**
 * VisitBadge.jsx - Badge statut visite de maintenance
 * Petit badge réutilisable avec icône + label coloré.
 */

import { Check, Clock, Minus, X } from 'lucide-react';

const VISIT_CONFIG = {
  completed: {
    label: 'Effectué',
    className: 'bg-green-100 text-green-800',
    Icon: Check,
  },
  pending: {
    label: 'À faire',
    className: 'bg-amber-100 text-amber-800',
    Icon: Clock,
  },
  skipped: {
    label: 'Non effectué',
    className: 'bg-gray-100 text-gray-600',
    Icon: Minus,
  },
  cancelled: {
    label: 'Annulé',
    className: 'bg-red-100 text-red-800',
    Icon: X,
  },
};

export function VisitBadge({ status, size = 'sm' }) {
  // Si pas de statut → à faire par défaut (pas de visite créée)
  const config = VISIT_CONFIG[status] || VISIT_CONFIG.pending;
  const { label, className, Icon } = config;

  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-xs'
    : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${className} ${sizeClasses}`}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {label}
    </span>
  );
}
