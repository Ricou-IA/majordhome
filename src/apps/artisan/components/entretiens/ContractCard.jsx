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

import { FileCheck, Clock, Archive, MapPin, Phone, ChevronRight, Globe } from 'lucide-react';
import { statutVisiteAnnee } from '@/lib/entretienVisitStatus';
import { CONTRACT_STATUSES } from '@services/contracts.service';
import { VisitBadge } from './VisitBadge';
import { EquipmentKindIcons } from '../shared/EquipmentKindIcons';

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
    cancelled: { icon: Clock, bg: 'bg-secondary-100', color: 'text-secondary-500' },
    archived: { icon: Archive, bg: 'bg-secondary-100', color: 'text-secondary-400' },
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
    <div className={`flex items-center gap-2 text-sm truncate ${isEmpty ? 'text-secondary-400' : 'text-secondary-600'}`}>
      <Icon className="w-4 h-4 text-secondary-400 flex-shrink-0" />
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
    client_id,
    client_name,
    client_address,
    client_postal_code,
    client_city,
    client_phone,
    amount,
    status,
    source,
  } = contract;

  // Adresse formatée (rue séparée du CP + ville)
  const streetAddress = client_address || null;
  const cityLine = [client_postal_code, client_city].filter(Boolean).join(', ');

  // Statut visite de l'année : réalisé, refusé par le client, ou à faire.
  const visitStatus = { realise: 'completed', refuse: 'refuse', a_faire: 'pending' }[statutVisiteAnnee(contract)];

  const formatAmount = (n) => {
    if (!n && n !== 0) return null;
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(n);
  };

  const isArchived = status === 'archived';
  const statutHorsActif = status && status !== 'active'
    ? CONTRACT_STATUSES.find((s) => s.value === status) || null
    : null;

  return (
    <div
      onClick={() => onClick?.(contract)}
      className={`
        group relative rounded-lg border p-4 transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-300' : ''}
        ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-secondary-200'}
        bg-white
        ${isArchived ? 'opacity-60' : ''}
      `}
    >
      {/* Ligne 1 : StatusIcon + Nom + VisitBadge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusIcon status={status} />
          <h3 className="font-medium text-secondary-900 truncate">{client_name || 'Sans nom'}</h3>
          <EquipmentKindIcons clientId={client_id} />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {source === 'web' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-caption font-medium rounded-full bg-indigo-100 text-indigo-700">
              <Globe className="w-2.5 h-2.5" />
              Web
            </span>
          )}
          {/* « À faire » ne vaut que pour un contrat actif : un contrat clos, en attente ou
              archivé affiche son statut, pas un entretien à faire qu'il n'a pas. */}
          {statutHorsActif ? (
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${statutHorsActif.color}`}>
              {statutHorsActif.label}
            </span>
          ) : (
            <VisitBadge status={visitStatus} />
          )}
        </div>
      </div>

      {/* Ligne 2 : Adresse (rue + CP/ville sur 2 lignes) */}
      <div className="mb-2">
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 text-secondary-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            {streetAddress ? (
              <p className="text-secondary-600 truncate">{streetAddress}</p>
            ) : (
              <p className="text-secondary-400">-</p>
            )}
            {cityLine && <p className="text-secondary-500 truncate">{cityLine}</p>}
          </div>
        </div>
      </div>

      {/* Ligne 3 : Téléphone */}
      <div className="mb-2">
        <InfoLine icon={Phone}>{client_phone}</InfoLine>
      </div>

      {/* Ligne 4 : Tarif */}
      {amount ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm font-medium text-blue-700 flex-shrink-0">{formatAmount(amount)}</span>
        </div>
      ) : null}

      {/* Hover chevron */}
      {onClick && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-5 h-5 text-secondary-400" />
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
    <div className="bg-white rounded-lg border border-secondary-200 p-4 animate-pulse">
      {/* Ligne 1 : Icon + Nom + Badge */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-secondary-200 rounded-full" />
          <div className="h-5 w-36 bg-secondary-200 rounded" />
        </div>
        <div className="h-5 w-16 bg-secondary-200 rounded-full" />
      </div>
      {/* Ligne 2 : Adresse */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 bg-secondary-200 rounded" />
        <div className="h-4 w-48 bg-secondary-200 rounded" />
      </div>
      {/* Ligne 3 : Téléphone */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 bg-secondary-200 rounded" />
        <div className="h-4 w-32 bg-secondary-200 rounded" />
      </div>
      {/* Ligne 4 : Fréquence + Tarif */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-secondary-200 rounded" />
          <div className="h-4 w-24 bg-secondary-200 rounded" />
        </div>
        <div className="h-4 w-16 bg-secondary-200 rounded" />
      </div>
    </div>
  );
}

export default ContractCard;
