/**
 * ContractStepEquipment.jsx
 * ============================================================================
 * Étape 2 du wizard contrat : Sélection équipements + tarification
 * Extrait de CreateContractModal.jsx
 * ============================================================================
 */

import { useMemo } from 'react';
import {
  Plus,
  Minus,
  AlertCircle,
  Check,
  Loader2,
  MapPin,
  Wrench,
  Calculator,
  Tag,
} from 'lucide-react';
import { EQUIPMENT_TYPE_CATEGORIES } from '@services/pricing.service';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function Step2Equipment({ pricingData, calculator, clientAddress }) {
  const { equipmentTypes, zones, isLoading: loadingPricing, error: pricingError } = pricingData;
  const { activeZone, items, pricing, addItem, removeItem, updateItemQuantity, isDetectingZone, durationMinutes } = calculator;

  // Grouper les types d'équipements par catégorie
  const groupedTypes = useMemo(() => {
    if (!equipmentTypes?.length) return [];
    const groups = {};
    for (const et of equipmentTypes) {
      if (!groups[et.category]) {
        const catInfo = EQUIPMENT_TYPE_CATEGORIES.find((c) => c.value === et.category);
        groups[et.category] = { category: et.category, label: catInfo?.label || et.category, items: [] };
      }
      groups[et.category].items.push(et);
    }
    return Object.values(groups);
  }, [equipmentTypes]);

  // Set des IDs sélectionnés pour lookup rapide
  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.equipmentTypeId)),
    [items]
  );

  if (loadingPricing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Chargement des tarifs...</span>
      </div>
    );
  }

  if (pricingError || (!loadingPricing && equipmentTypes?.length === 0)) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-900 mb-1">Impossible de charger les tarifs</p>
        <p className="text-xs text-gray-500">
          {pricingError?.message || 'La grille tarifaire est vide. Contactez l\'administrateur.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Zone tarifaire — calculée depuis le temps de trajet */}
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
        {isDetectingZone && (
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
        )}
        <span className="text-sm text-blue-800">
          {activeZone ? (
            <>
              <strong>{activeZone.label}</strong>
              <span className="text-blue-600 ml-1">
                {durationMinutes != null
                  ? `(~${durationMinutes} min depuis Gaillac${activeZone.supplement > 0 ? ` · +${parseFloat(activeZone.supplement).toFixed(0)}€ déplacement` : ''})`
                  : `(CP ${clientAddress?.postalCode || ''}${activeZone.supplement > 0 ? ` · +${parseFloat(activeZone.supplement).toFixed(0)}€ déplacement` : ''})`
                }
              </span>
            </>
          ) : (
            <span className="text-amber-700">Adresse non renseignée — zone par défaut appliquée</span>
          )}
        </span>
      </div>

      {/* Sélecteur d'équipements par catégorie */}
      <div className="space-y-4">
        {groupedTypes.map((group) => (
          <div key={group.category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {group.label}
            </h4>
            <div className="space-y-1.5">
              {group.items.map((et) => {
                const isSelected = selectedIds.has(et.id);
                const selectedItem = items.find((item) => item.equipmentTypeId === et.id);
                const rate = pricingData.rates?.find(
                  (r) =>
                    (r.zone_id === activeZone?.id || r.zone?.id === activeZone?.id) &&
                    (r.equipment_type_id === et.id || r.equipment_type?.id === et.id)
                );
                const price = rate ? parseFloat(rate.price) : 0;
                const unitPrice = rate ? parseFloat(rate.unit_price) : 0;

                return (
                  <div
                    key={et.id}
                    className={`
                      flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer
                      transition-all duration-150
                      ${isSelected
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }
                    `}
                    onClick={() => {
                      if (isSelected) {
                        const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                        if (idx >= 0) removeItem(idx);
                      } else {
                        addItem(et.id, et.has_unit_pricing ? (et.included_units || 1) : 1);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                          {et.label}
                        </p>
                        {et.has_unit_pricing && unitPrice > 0 && (
                          <p className="text-xs text-gray-500">
                            {et.included_units > 0
                              ? `${et.included_units} ${et.unit_label} inclus, +${unitPrice.toFixed(0)}€/${et.unit_label} suppl.`
                              : `${unitPrice.toFixed(0)}€ / ${et.unit_label}`
                            }
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      {isSelected && et.has_unit_pricing && (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                              if (idx >= 0) updateItemQuantity(idx, (selectedItem?.quantity || 1) - 1);
                            }}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">
                            {selectedItem?.quantity || 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const idx = items.findIndex((item) => item.equipmentTypeId === et.id);
                              if (idx >= 0) updateItemQuantity(idx, (selectedItem?.quantity || 1) + 1);
                            }}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <span className={`text-sm font-semibold tabular-nums ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                        {isSelected && selectedItem
                          ? `${selectedItem.lineTotal?.toFixed(0) || price.toFixed(0)}€`
                          : et.has_unit_pricing && et.included_units === 0
                            ? `${unitPrice.toFixed(0)}€/${et.unit_label}`
                            : `${price.toFixed(0)}€`
                        }
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Récapitulatif tarif */}
      {items.length > 0 && (
        <PricingSummary items={items} pricing={pricing} />
      )}

      {/* Message si aucun équipement sélectionné */}
      {items.length === 0 && groupedTypes.length > 0 && (
        <div className="text-center py-4 text-gray-500">
          <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm">Sélectionnez au moins un équipement pour calculer le tarif</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RÉCAPITULATIF TARIF
// ============================================================================

function PricingSummary({ items, pricing }) {
  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-gray-600" />
        <h4 className="text-sm font-semibold text-gray-700">Récapitulatif</h4>
      </div>

      {items.map((item, idx) => (
        <div key={idx} className="flex justify-between text-sm">
          <span className="text-gray-600">
            {item.equipType?.label || item.equipmentTypeCode}
            {item.equipType?.has_unit_pricing && item.quantity > 1 && (
              <span className="text-gray-400 ml-1">x{item.quantity}</span>
            )}
          </span>
          <span className="font-medium text-gray-900 tabular-nums">{item.lineTotal?.toFixed(2)}€</span>
        </div>
      ))}

      <div className="border-t border-gray-200 pt-2 mt-2" />

      <div className="flex justify-between text-sm">
        <span className="text-gray-600">Sous-total</span>
        <span className="font-medium text-gray-900 tabular-nums">{pricing.subtotal.toFixed(2)}€</span>
      </div>

      {pricing.discountPercent > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-green-700 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" />
            Remise {items.filter((i) => i.basePrice > 0).length} equip. (-{pricing.discountPercent}%)
          </span>
          <span className="font-medium text-green-700 tabular-nums">-{pricing.discountAmount.toFixed(2)}€</span>
        </div>
      )}

      <div className="flex justify-between text-base pt-1">
        <span className="font-semibold text-gray-900">Total annuel</span>
        <span className="font-bold text-blue-700 tabular-nums">{pricing.total.toFixed(2)}€</span>
      </div>
    </div>
  );
}
