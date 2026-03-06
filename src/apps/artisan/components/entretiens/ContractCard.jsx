/**
 * ContractCard.jsx - Carte contrat d'entretien
 * ============================================================================
 * Harmonisé avec ClientCard.jsx :
 *   - Icône statut colorée dans cercle (actif=vert, expiré=gris, pending=amber)
 *   - Même hover/border : hover:shadow-md hover:border-blue-300
 *   - ChevronRight au group-hover
 *   - 4 lignes fixes : Nom+Badges, Adresse, Téléphone, Fréquence+Tarif
 *
 * @version 2.0.0 - Restyle icône statut, hover alignement
 * @version 1.0.0 - Sprint 5
 * ============================================================================
 */

import { FileCheck, Clock, Archive, MapPin, Phone, Wrench, ChevronRight } from 'lucide-react';
import { CONTRACT_FREQUENCIES } from '@services/contracts.service';
import { VisitBadge } from './VisitBadge';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Icône statut contrat dans un cercle coloré (pattern CategoryIcon de ClientCard)
 */
const StatusIcon = ({ status }) => {
  const config = {
    active: { icon: FileCheck, bg: 'bg-green-100', color: 'text-green-600' },
    pending: { icon: Clock, bg: 'bg-amber-100', color: 'text-amber-600' },
    cancelled: { icon: Clock, bg: 'bg-gray-100', color: 'text-gray-500' },
    archived: { icon: Archive, bg: 'bg-slate-100', color: 'text-slate-400' },
  };

  const { icon: Icon, bg, color } = config[status] || config.cancelled;

  return (
    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${bg}`}>
      <Icon className={`w-4 h-4 ${color}`} />
    </div>
  );
};

/**
 * Ligne d'information avec icône
 */
const InfoLine = ({ icon: Icon, children }) => {
  const isEmpty = !children;
  return (
    <div className={`flex items-center gap-2 text-sm truncate ${isEmpty ? 'text-gray-400' : 'text-gray-600'}`}>
      <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <span className="truncate">{children || '-'}</span>
    </div>
  );
};

// ============================================================================
// CONTRACT CARD
// ============================================================================

export function ContractCard({ contract, onClick, selected = false }) {
  if (!contract) return null;

  const {
    client_name,
    client_address,
    client_postal_code,
    client_city,
    client_phone,
    frequency,
    amount,
    status,
    next_maintenance_date,
  } = contract;

  // Adresse formatée (rue séparée du CP + ville)
  const streetAddress = client_address || null;
  const cityLine = [client_postal_code, client_city].filter(Boolean).join(', ');

  // Label fréquence
  const frequencyLabel = CONTRACT_FREQUENCIES.find((f) => f.value === frequency)?.label || frequency || '-';

  // Statut visite calculé depuis next_maintenance_date
  const visitStatus =
    next_maintenance_date && new Date(next_maintenance_date) > new Date() ? 'completed' : 'pending';

  const formatAmount = (n) => {
    if (!n && n !== 0) return null;
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(n);
  };

  const isArchived = status === 'archived';

  return (
    <div
      onClick={() => onClick?.(contract)}
      className={`
        group relative rounded-lg border p-4 transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-300' : ''}
        ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}
        bg-white
        ${isArchived ? 'opacity-60' : ''}
      `}
    >
      {/* Ligne 1 : StatusIcon + Nom + VisitBadge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusIcon status={status} />
          <h3 className="font-medium text-gray-900 truncate">{client_name || 'Sans nom'}</h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <VisitBadge status={visitStatus} />
        </div>
      </div>

      {/* Ligne 2 : Adresse (rue + CP/ville sur 2 lignes) */}
      <div className="mb-2">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            {streetAddress ? (
              <p className="text-gray-600 truncate">{streetAddress}</p>
            ) : (
              <p className="text-gray-400">-</p>
            )}
            {cityLine && <p className="text-gray-500 truncate">{cityLine}</p>}
          </div>
        </div>
      </div>

      {/* Ligne 3 : Téléphone */}
      <div className="mb-2">
        <InfoLine icon={Phone}>{client_phone}</InfoLine>
      </div>

      {/* Ligne 4 : Fréquence + Tarif */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-600 truncate">{frequencyLabel}</span>
        </div>
        {amount ? (
          <span className="text-sm font-medium text-blue-700 flex-shrink-0">{formatAmount(amount)}</span>
        ) : null}
      </div>

      {/* Hover chevron */}
      {onClick && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SKELETON
// ============================================================================

export function ContractCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
      {/* Ligne 1 : Icon + Nom + Badge */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-200 rounded-full" />
          <div className="h-5 w-36 bg-gray-200 rounded" />
        </div>
        <div className="h-5 w-16 bg-gray-200 rounded-full" />
      </div>
      {/* Ligne 2 : Adresse */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-4 w-48 bg-gray-200 rounded" />
      </div>
      {/* Ligne 3 : Téléphone */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </div>
      {/* Ligne 4 : Fréquence + Tarif */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
        </div>
        <div className="h-4 w-16 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

export default ContractCard;
