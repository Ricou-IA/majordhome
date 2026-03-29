/**
 * EquipmentList.jsx - Majord'home Artisan
 * ============================================================================
 * Liste des équipements d'un client.
 * Affiche : type, marque/modèle, statut contrat, dates, actions.
 * 
 * @example
 * <EquipmentList 
 *   equipments={equipments}
 *   onAdd={() => setShowAddModal(true)}
 *   onEdit={(eq) => openEditModal(eq)}
 *   onDelete={(eq) => confirmDelete(eq)}
 * />
 * ============================================================================
 */

import React, { useState, useMemo } from 'react';
import {
  Wrench,
  Flame,
  Wind,
  Droplets,
  Thermometer,
  Fan,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Shield,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Link2,
  Unlink,
} from 'lucide-react';
import { EQUIPMENT_TYPES, EQUIPMENT_CATEGORIES } from '@services/clients.service';
import { usePricingEquipmentTypes } from '@hooks/useClients';
import { formatDateShortFR } from '@/lib/utils';

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Icône selon le type d'équipement
 */
const getEquipmentIcon = (type) => {
  const icons = {
    chaudiere_gaz: Flame,
    chaudiere_fioul: Flame,
    chaudiere_bois: Flame,
    pac_air_eau: Thermometer,
    pac_air_air: Wind,
    pac_geothermie: Thermometer,
    climatisation: Fan,
    vmc: Wind,
    chauffe_eau: Droplets,
    chauffe_eau_thermo: Droplets,
    ballon_ecs: Droplets,
    poele: Flame,
  };
  return icons[type] || Wrench;
};

/**
 * Couleur selon le type d'équipement
 */
const getEquipmentColor = (type) => {
  const colors = {
    chaudiere_gaz: 'bg-orange-100 text-orange-600',
    chaudiere_fioul: 'bg-amber-100 text-amber-600',
    chaudiere_bois: 'bg-yellow-100 text-yellow-700',
    pac_air_eau: 'bg-blue-100 text-blue-600',
    pac_air_air: 'bg-cyan-100 text-cyan-600',
    pac_geothermie: 'bg-emerald-100 text-emerald-600',
    climatisation: 'bg-sky-100 text-sky-600',
    vmc: 'bg-indigo-100 text-indigo-600',
    chauffe_eau: 'bg-teal-100 text-teal-600',
    chauffe_eau_thermo: 'bg-teal-100 text-teal-600',
    ballon_ecs: 'bg-teal-100 text-teal-600',
    poele: 'bg-red-100 text-red-600',
  };
  return colors[type] || 'bg-gray-100 text-gray-600';
};

/**
 * Label du type d'équipement
 */
const getEquipmentLabel = (type) => {
  // Chercher dans les types legacy puis dans les catégories DB
  const found = EQUIPMENT_TYPES.find(t => t.value === type)
    || EQUIPMENT_CATEGORIES.find(t => t.value === type);
  return found?.label || type || 'Équipement';
};

// formatDate alias → formatDateShortFR from utils
const formatDate = formatDateShortFR;

/**
 * Calcule le statut de maintenance
 */
const getMaintenanceStatus = (nextDate) => {
  if (!nextDate) {
    return { status: 'none', label: 'Non planifié', className: 'text-gray-400 bg-gray-50' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const maintenanceDate = new Date(nextDate);
  maintenanceDate.setHours(0, 0, 0, 0);
  
  const diffDays = Math.ceil((maintenanceDate - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { 
      status: 'overdue', 
      label: `En retard (${Math.abs(diffDays)}j)`, 
      className: 'text-red-600 bg-red-50',
      icon: AlertCircle 
    };
  } else if (diffDays <= 30) {
    return { 
      status: 'upcoming', 
      label: `Dans ${diffDays}j`, 
      className: 'text-amber-600 bg-amber-50',
      icon: Clock 
    };
  } else {
    return { 
      status: 'scheduled', 
      label: formatDate(nextDate), 
      className: 'text-green-600 bg-green-50',
      icon: CheckCircle2 
    };
  }
};

/**
 * Vérifie si la garantie est active
 */
const isWarrantyActive = (warrantyEndDate) => {
  if (!warrantyEndDate) return false;
  return new Date(warrantyEndDate) > new Date();
};

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Badge de statut contrat
 */
const ContractStatusBadge = ({ status }) => {
  const config = {
    active: { 
      label: 'Sous contrat', 
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
      label: 'Hors contrat', 
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

/**
 * Carte d'un équipement
 */
const EquipmentCard = ({
  equipment,
  onEdit,
  onDelete,
  onAddToContract,
  onRemoveFromContract,
  expanded,
  onToggleExpand,
  pricingTypesMap = {},
  hasContract = false,
  isLinkedToContract = false,
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const {
    id,
    equipment_type,
    brand,
    model,
    serial_number,
    installation_date,
    warranty_end_date,
    contract_status,
    last_maintenance_date,
    next_maintenance_date,
    notes,
  } = equipment;

  const Icon = getEquipmentIcon(equipment_type);
  const iconColor = getEquipmentColor(equipment_type);
  const maintenanceStatus = getMaintenanceStatus(next_maintenance_date);
  const MaintenanceIcon = maintenanceStatus.icon || Calendar;
  const hasWarranty = isWarrantyActive(warranty_end_date);

  return (
    <div className="bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow relative">
      {/* En-tête */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Icône + Type */}
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h4 className="font-medium text-gray-900">
                {equipment.equipment_type_id && pricingTypesMap[equipment.equipment_type_id]
                  ? pricingTypesMap[equipment.equipment_type_id].label
                  : getEquipmentLabel(equipment_type)}
              </h4>
              {(brand || model || equipment.installation_year) && (
                <p className="text-sm text-gray-600 truncate">
                  {[brand, model, equipment.installation_year].filter(Boolean).join(' · ')}
                </p>
              )}
              {serial_number && (
                <p className="text-xs text-gray-400 font-mono truncate">
                  N° Série : {serial_number}
                </p>
              )}
            </div>
          </div>

          {/* Actions + Badge */}
          <div className="flex items-center gap-2">
            {hasContract && (
              <ContractStatusBadge status={isLinkedToContract ? 'active' : 'none'} />
            )}
            
            {/* Menu actions */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-[60]"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-[70] py-1">
                    <button
                      onClick={() => { onEdit?.(equipment); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="w-4 h-4" />
                      Modifier
                    </button>

                    {/* Lier / Délier du contrat */}
                    {hasContract && !isLinkedToContract && onAddToContract && (
                      <button
                        onClick={() => { onAddToContract(equipment); setShowMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                      >
                        <Link2 className="w-4 h-4" />
                        Ajouter au contrat
                      </button>
                    )}
                    {hasContract && isLinkedToContract && onRemoveFromContract && (
                      <button
                        onClick={() => { onRemoveFromContract(equipment); setShowMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50"
                      >
                        <Unlink className="w-4 h-4" />
                        Retirer du contrat
                      </button>
                    )}

                    {/* Séparateur */}
                    <div className="border-t border-gray-100 my-1" />

                    <button
                      onClick={() => { onDelete?.(equipment); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Supprimer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Infos rapides */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {/* Prochain entretien (uniquement si une date existe) */}
          {next_maintenance_date && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${maintenanceStatus.className}`}>
              <MaintenanceIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">
                {maintenanceStatus.label}
              </span>
            </div>
          )}

          {/* Garantie */}
          {hasWarranty && (
            <div className="flex items-center gap-1.5 text-blue-600">
              <Shield className="w-3.5 h-3.5" />
              <span className="text-xs">Sous garantie</span>
            </div>
          )}

        </div>

        {/* Bouton détails */}
        <button
          onClick={onToggleExpand}
          className="mt-3 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Masquer les notes
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Voir les notes
            </>
          )}
        </button>
      </div>

      {/* Détails (expandable) */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-gray-100 bg-gray-50 rounded-b-lg">
          <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
            {/* Date installation */}
            {installation_date && (
              <div>
                <span className="text-gray-500">Installation</span>
                <p className="text-gray-900">{formatDate(installation_date)}</p>
              </div>
            )}

            {/* Fin garantie */}
            {warranty_end_date && (
              <div>
                <span className="text-gray-500">Fin garantie</span>
                <p className={hasWarranty ? 'text-green-600' : 'text-gray-900'}>
                  {formatDate(warranty_end_date)}
                </p>
              </div>
            )}

            {/* Dernier entretien */}
            {last_maintenance_date && (
              <div>
                <span className="text-gray-500">Dernier entretien</span>
                <p className="text-gray-900">{formatDate(last_maintenance_date)}</p>
              </div>
            )}

            {/* Prochain entretien */}
            {next_maintenance_date && (
              <div>
                <span className="text-gray-500">Prochain entretien</span>
                <p className={maintenanceStatus.status === 'overdue' ? 'text-red-600 font-medium' : 'text-gray-900'}>
                  {formatDate(next_maintenance_date)}
                </p>
              </div>
            )}
          </div>

          {/* Notes */}
          {notes && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <span className="text-sm text-gray-500">Notes</span>
              <p className="text-sm text-gray-700 mt-1">{notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * Liste des équipements d'un client
 * 
 * @param {Object} props
 * @param {Array} props.equipments - Liste des équipements
 * @param {boolean} [props.loading] - Chargement en cours
 * @param {Function} [props.onAdd] - Callback ajout
 * @param {Function} [props.onEdit] - Callback édition
 * @param {Function} [props.onDelete] - Callback suppression
 * @param {boolean} [props.readOnly] - Mode lecture seule
 */
export function EquipmentList({
  equipments = [],
  loading = false,
  onAdd,
  onEdit,
  onDelete,
  onAddToContract,
  onRemoveFromContract,
  hasContract = false,
  contractEquipmentIds = new Set(),
  readOnly = false,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const { equipmentTypes } = usePricingEquipmentTypes();

  // Map pricing types par id pour lookup rapide des labels
  const pricingTypesMap = useMemo(() => {
    const map = {};
    for (const t of equipmentTypes) {
      map[t.id] = t;
    }
    return map;
  }, [equipmentTypes]);

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  // État vide
  if (!loading && equipments.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <Wrench className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-gray-500 mb-4">Aucun équipement enregistré</p>
        {!readOnly && onAdd && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un équipement
          </button>
        )}
      </div>
    );
  }

  // Chargement
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg" />
              <div className="flex-1">
                <div className="h-5 w-32 bg-gray-200 rounded mb-2" />
                <div className="h-4 w-48 bg-gray-200 rounded" />
              </div>
              <div className="h-6 w-24 bg-gray-200 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* En-tête avec bouton ajouter */}
      {!readOnly && onAdd && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-700">
            {equipments.length} équipement{equipments.length !== 1 ? 's' : ''}
          </h3>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter
          </button>
        </div>
      )}

      {/* Liste des équipements */}
      {equipments.map(equipment => (
        <EquipmentCard
          key={equipment.id}
          equipment={equipment}
          onEdit={readOnly ? undefined : onEdit}
          onDelete={readOnly ? undefined : onDelete}
          onAddToContract={readOnly ? undefined : onAddToContract}
          onRemoveFromContract={readOnly ? undefined : onRemoveFromContract}
          hasContract={hasContract}
          isLinkedToContract={contractEquipmentIds.has(equipment.id)}
          expanded={expandedId === equipment.id}
          onToggleExpand={() => toggleExpand(equipment.id)}
          pricingTypesMap={pricingTypesMap}
        />
      ))}
    </div>
  );
}

// ============================================================================
// VARIANTE : LISTE COMPACTE (pour modale)
// ============================================================================

/**
 * Version compacte de la liste (pour affichage dans modale)
 */
export function EquipmentListCompact({ equipments = [], onSelect }) {
  const { equipmentTypes } = usePricingEquipmentTypes();

  // Map pricing types par id pour lookup rapide des labels
  const pricingTypesMap = useMemo(() => {
    const map = {};
    for (const t of equipmentTypes) {
      map[t.id] = t;
    }
    return map;
  }, [equipmentTypes]);

  if (equipments.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        Aucun équipement
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {equipments.map(equipment => {
        const Icon = getEquipmentIcon(equipment.equipment_type);
        const iconColor = getEquipmentColor(equipment.equipment_type);

        return (
          <div
            key={equipment.id}
            onClick={() => onSelect?.(equipment)}
            className={`
              flex items-center gap-3 p-2 rounded-lg border border-gray-200
              ${onSelect ? 'cursor-pointer hover:bg-gray-50' : ''}
            `}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColor}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {equipment.equipment_type_id && pricingTypesMap[equipment.equipment_type_id]
                  ? pricingTypesMap[equipment.equipment_type_id].label
                  : getEquipmentLabel(equipment.equipment_type)}
              </p>
              {(equipment.brand || equipment.model) && (
                <p className="text-xs text-gray-500 truncate">
                  {[equipment.brand, equipment.model].filter(Boolean).join(' ')}
                </p>
              )}
            </div>
            <ContractStatusBadge status={equipment.contract_status} />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default EquipmentList;
