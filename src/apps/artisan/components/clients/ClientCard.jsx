/**
 * ClientCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte compacte affichant un client dans la liste.
 * Affiche : nom, adresse, statut contrat, téléphone, prochain entretien.
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
  MapPin, 
  Phone, 
  Mail, 
  Calendar, 
  Wrench,
  FileText,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock
} from 'lucide-react';

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Formate une date en français
 * @param {string} dateString - Date ISO
 * @returns {string} Date formatée
 */
const formatDate = (dateString) => {
  if (!dateString) return null;
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
};

/**
 * Calcule le statut de l'entretien
 * @param {string} nextMaintenanceDate - Date du prochain entretien
 * @returns {Object} { status, label, color }
 */
const getMaintenanceStatus = (nextMaintenanceDate) => {
  if (!nextMaintenanceDate) {
    return { status: 'none', label: 'Non planifié', color: 'text-gray-400' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const maintenanceDate = new Date(nextMaintenanceDate);
  maintenanceDate.setHours(0, 0, 0, 0);
  
  const diffDays = Math.ceil((maintenanceDate - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'overdue', label: 'En retard', color: 'text-red-600', icon: AlertCircle };
  } else if (diffDays <= 30) {
    return { status: 'upcoming', label: 'À venir', color: 'text-amber-600', icon: Clock };
  } else {
    return { status: 'scheduled', label: 'Planifié', color: 'text-green-600', icon: CheckCircle2 };
  }
};

/**
 * Badge de statut contrat
 */
const ContractBadge = ({ status }) => {
  const config = {
    active: { 
      label: 'Contrat actif', 
      className: 'bg-green-100 text-green-700 border-green-200' 
    },
    pending: { 
      label: 'En attente', 
      className: 'bg-amber-100 text-amber-700 border-amber-200' 
    },
    expired: { 
      label: 'Expiré', 
      className: 'bg-red-100 text-red-700 border-red-200' 
    },
    none: { 
      label: 'Sans contrat', 
      className: 'bg-gray-100 text-gray-500 border-gray-200' 
    },
  };

  const { label, className } = config[status] || config.none;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${className}`}>
      {label}
    </span>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Carte client pour la liste
 * 
 * @param {Object} props
 * @param {Object} props.client - Données du client
 * @param {Function} [props.onClick] - Callback au clic
 * @param {boolean} [props.selected] - Client sélectionné
 * @param {boolean} [props.compact] - Mode compact (moins d'infos)
 */
export function ClientCard({ 
  client, 
  onClick, 
  selected = false,
  compact = false 
}) {
  if (!client) return null;

  const {
    id,
    name,
    address,
    postal_code,
    city,
    phone,
    email,
    contract_status,
    next_maintenance_date,
    equipments_count,
  } = client;

  // Statut de l'entretien
  const maintenanceStatus = getMaintenanceStatus(next_maintenance_date);
  const MaintenanceIcon = maintenanceStatus.icon || Calendar;

  // Adresse formatée
  const fullAddress = [address, postal_code, city].filter(Boolean).join(', ');
  const shortAddress = city ? `${postal_code || ''} ${city}`.trim() : null;

  // Handler de clic
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
        group relative bg-white rounded-lg border transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-blue-300' : ''}
        ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}
        ${compact ? 'p-3' : 'p-4'}
      `}
    >
      {/* En-tête : Nom + Badge contrat */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-gray-900 truncate">
              {name || 'Client sans nom'}
            </h3>
          </div>
        </div>
        
        <ContractBadge status={contract_status} />
      </div>

      {/* Adresse */}
      {(shortAddress || fullAddress) && (
        <div className="flex items-start gap-2 text-sm text-gray-600 mb-2">
          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <span className="truncate">
            {compact ? shortAddress : (fullAddress || shortAddress)}
          </span>
        </div>
      )}

      {/* Ligne contact : Téléphone + Email */}
      {!compact && (phone || email) && (
        <div className="flex items-center gap-4 text-sm mb-2">
          {phone && (
            <button
              onClick={handlePhoneClick}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>{phone}</span>
            </button>
          )}
          {email && (
            <button
              onClick={handleEmailClick}
              className="flex items-center gap-1.5 text-gray-600 hover:text-gray-800 hover:underline truncate"
            >
              <Mail className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{email}</span>
            </button>
          )}
        </div>
      )}

      {/* Ligne infos : Équipements + Prochain entretien */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        {/* Équipements */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Wrench className="w-3.5 h-3.5" />
          <span>
            {equipments_count || 0} équipement{(equipments_count || 0) !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Prochain entretien */}
        {contract_status === 'active' && (
          <div className={`flex items-center gap-1.5 text-xs ${maintenanceStatus.color}`}>
            <MaintenanceIcon className="w-3.5 h-3.5" />
            <span>
              {next_maintenance_date 
                ? formatDate(next_maintenance_date)
                : 'Non planifié'
              }
            </span>
          </div>
        )}
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

  const { name, city, postal_code, contract_status } = client;

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
          <p className="font-medium text-gray-900 truncate">{name}</p>
          {(city || postal_code) && (
            <p className="text-sm text-gray-500 truncate">
              {[postal_code, city].filter(Boolean).join(' ')}
            </p>
          )}
        </div>
      </div>

      <ContractBadge status={contract_status} />
    </div>
  );
}

// ============================================================================
// VARIANTE : CARTE SKELETON (chargement)
// ============================================================================

/**
 * Skeleton de la carte client (état de chargement)
 */
export function ClientCardSkeleton({ compact = false }) {
  return (
    <div className={`bg-white rounded-lg border border-gray-200 animate-pulse ${compact ? 'p-3' : 'p-4'}`}>
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-200 rounded-full" />
          <div className="h-5 w-32 bg-gray-200 rounded" />
        </div>
        <div className="h-5 w-20 bg-gray-200 rounded-full" />
      </div>

      {/* Adresse */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 bg-gray-200 rounded" />
        <div className="h-4 w-48 bg-gray-200 rounded" />
      </div>

      {/* Contact */}
      {!compact && (
        <div className="flex items-center gap-4 mb-3">
          <div className="h-4 w-28 bg-gray-200 rounded" />
          <div className="h-4 w-36 bg-gray-200 rounded" />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="h-4 w-24 bg-gray-200 rounded" />
        <div className="h-4 w-20 bg-gray-200 rounded" />
      </div>
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ClientCard;
