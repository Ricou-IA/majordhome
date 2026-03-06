/**
 * ClientCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte compacte affichant un client dans la liste.
 * Format fixe 4 lignes : Nom/Contrat, Adresse, Téléphone, Email
 * 
 * v2.0.0 - Format fixe avec placeholders pour hauteur uniforme
 * 
 * @example
 * <ClientCard 
 *   client={clientData} 
 *   onClick={() => openModal(client.id)} 
 * />
 * ============================================================================
 */

import React from 'react';
import {
  User,
  Users,
  Building2,
  MapPin,
  Phone,
  Mail,
  ChevronRight,
  Archive,
  FileText,
} from 'lucide-react';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Icône contrat (vert = actif, gris = sans contrat)
 */
const ContractIcon = ({ hasContract }) => (
  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
    hasContract ? 'bg-green-100' : 'bg-gray-100'
  }`}>
    <FileText className={`w-3.5 h-3.5 ${
      hasContract ? 'text-green-600' : 'text-gray-400'
    }`} />
  </div>
);

/**
 * Ligne d'information avec icône
 */
const InfoLine = ({ icon: Icon, children, onClick, isLink = false }) => {
  const content = children || '-';
  const isEmpty = !children;
  
  if (isLink && !isEmpty && onClick) {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline truncate w-full text-left"
      >
        <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="truncate">{content}</span>
      </button>
    );
  }
  
  return (
    <div className={`flex items-center gap-2 text-sm truncate ${isEmpty ? 'text-gray-400' : 'text-gray-600'}`}>
      <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <span className="truncate">{content}</span>
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Carte client pour la liste - Format fixe 4 lignes
 * 
 * @param {Object} props
 * @param {Object} props.client - Données du client
 * @param {Function} [props.onClick] - Callback au clic
 * @param {boolean} [props.selected] - Client sélectionné
 */
export function ClientCard({ 
  client, 
  onClick, 
  selected = false
}) {
  if (!client) return null;

  const {
    id,
    display_name,
    first_name,
    last_name,
    address,
    postal_code,
    city,
    phone,
    email,
    has_active_contract,
    is_archived,
    client_category,
    // Compat ancien format
    name,
  } = client;

  // Détermine si contrat actif (colonne calculée dans la vue)
  const hasContract = has_active_contract === true;
  const isArchived = is_archived === true;
  const isEntreprise = client_category === 'entreprise';

  // Icône selon catégorie
  const CategoryIcon = isArchived ? Archive : isEntreprise ? Building2 : Users;
  const iconBg = isArchived ? 'bg-amber-100' : isEntreprise ? 'bg-purple-100' : 'bg-amber-100';
  const iconColor = isArchived ? 'text-amber-600' : isEntreprise ? 'text-purple-600' : 'text-amber-600';

  // Nom affiché (compatible ancien et nouveau format)
  const displayName = display_name || name || `${last_name || ''} ${first_name || ''}`.trim() || 'Client sans nom';

  // Adresse formatée (rue séparée du CP + ville)
  const streetAddress = address || null;
  const cityLine = [postal_code, city].filter(Boolean).join(', ');

  // Handler de clic sur la carte
  const handleClick = () => {
    if (onClick) {
      onClick(client);
    }
  };

  // Handler téléphone (empêche la propagation)
  const handlePhoneClick = (e) => {
    e.stopPropagation();
    if (phone) {
      window.location.href = `tel:${phone.replace(/\s/g, '')}`;
    }
  };

  // Handler email (empêche la propagation)
  const handleEmailClick = (e) => {
    e.stopPropagation();
    if (email) {
      window.location.href = `mailto:${email}`;
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`
        group relative rounded-lg border p-4 transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-300' : ''}
        ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}
        ${isArchived ? 'bg-gray-50/80 opacity-60' : 'bg-white'}
      `}
    >
      {/* Ligne 1 : Nom + Badges */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${iconBg}`}>
            <CategoryIcon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <h3 className="font-medium text-gray-900 truncate">
            {displayName}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isArchived && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border bg-amber-100 text-amber-700 border-amber-200">
              Archivé
            </span>
          )}
          {hasContract && <ContractIcon hasContract />}
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
            {cityLine && (
              <p className="text-gray-500 truncate">{cityLine}</p>
            )}
          </div>
        </div>
      </div>

      {/* Ligne 3 : Téléphone */}
      <div className="mb-2">
        <InfoLine 
          icon={Phone} 
          isLink={!!phone}
          onClick={handlePhoneClick}
        >
          {phone}
        </InfoLine>
      </div>

      {/* Ligne 4 : Email */}
      <div>
        <InfoLine 
          icon={Mail}
          isLink={!!email}
          onClick={handleEmailClick}
        >
          {email}
        </InfoLine>
      </div>

      {/* Indicateur de clic */}
      {onClick && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VARIANTE : CARTE COMPACTE (pour sélection rapide)
// ============================================================================

/**
 * Version compacte de la carte client (pour autocomplete, sélection)
 */
export function ClientCardCompact({ client, onClick, selected = false }) {
  if (!client) return null;

  const { display_name, name, city, postal_code, has_active_contract } = client;
  const hasContract = has_active_contract === true;
  const clientName = display_name || name || 'Client sans nom';

  return (
    <div
      onClick={() => onClick?.(client)}
      className={`
        flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer
        transition-colors duration-150
        ${selected 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-gray-600" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{clientName}</p>
          {(city || postal_code) && (
            <p className="text-sm text-gray-500 truncate">
              {[postal_code, city].filter(Boolean).join(' ')}
            </p>
          )}
        </div>
      </div>

      {hasContract && <ContractIcon hasContract />}
    </div>
  );
}

// ============================================================================
// VARIANTE : CARTE SKELETON (chargement)
// ============================================================================

/**
 * Skeleton de la carte client (état de chargement)
 */
export function ClientCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
      {/* Ligne 1 : Nom + Badge */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-200 rounded-full" />
          <div className="h-5 w-36 bg-gray-200 rounded" />
        </div>
        <div className="h-5 w-20 bg-gray-200 rounded-full" />
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

      {/* Ligne 4 : Email */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-4 w-40 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ClientCard;
