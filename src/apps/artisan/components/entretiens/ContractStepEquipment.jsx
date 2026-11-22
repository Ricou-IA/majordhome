/**
 * ContractStepEquipment.jsx
 * ============================================================================
 * Étape 2 du wizard contrat : équipements + tarification
 * Extrait de CreateContractModal.jsx
 *
 * Deux sources de lignes :
 *   - les équipements DÉJÀ RECENSÉS chez le client (cochés d'office, rattachés au contrat
 *     à la création — jamais recréés) ;
 *   - les types cochés en plus, qui créent de nouveaux équipements.
 * `lines` / `pricing` portent l'ensemble (cf. useContractCreationLines).
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
  ClipboardCheck,
  RefreshCw,
} from 'lucide-react';
import { indexReferentiel, grouperTypesParCategorie } from '@/lib/equipmentReferential';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function Step2Equipment({ pricingData, calculator, clientAddress, lines = [], pricing, recensed = null }) {
  const { equipmentTypes, isLoading: loadingPricing, error: pricingError } = pricingData;
  const { activeZone, items, addItem, removeItem, updateItemQuantity, isDetectingZone, durationMinutes, hqLabel } = calculator;
  const hasRecensed = (recensed?.lines?.length || 0) > 0;
  const zoneSupplement = parseFloat(activeZone?.supplement || 0);

  // Grouper les types d'équipements par catégorie de l'org (pricingData.categories)
  const groupedTypes = useMemo(() => {
    if (!equipmentTypes?.length) return [];
    const index = indexReferentiel({ categories: pricingData.categories || [], equipmentTypes });
    return grouperTypesParCategorie(index, equipmentTypes).map((g) => ({
      key: g.category?.id ?? 'sans-categorie', label: g.label, items: g.types,
    }));
  }, [equipmentTypes, pricingData.categories]);

  // Set des IDs sélectionnés pour lookup rapide
  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.equipmentTypeId)),
    [items]
  );

  if (loadingPricing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="ml-2 text-sm text-secondary-500">Chargement des tarifs...</span>
      </div>
    );
  }

  if (pricingError || (!loadingPricing && equipmentTypes?.length === 0)) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-secondary-900 mb-1">Impossible de charger les tarifs</p>
        <p className="text-xs text-secondary-500">
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
                  ? `(~${durationMinutes} min${hqLabel ? ` depuis ${hqLabel}` : ''}${activeZone.supplement > 0 ? ` · +${parseFloat(activeZone.supplement).toFixed(0)}€ déplacement` : ''})`
                  : `(CP ${clientAddress?.postalCode || ''}${activeZone.supplement > 0 ? ` · +${parseFloat(activeZone.supplement).toFixed(0)}€ déplacement` : ''})`
                }
              </span>
            </>
          ) : (
            <span className="text-amber-700">Adresse non renseignée — zone par défaut appliquée</span>
          )}
        </span>
      </div>

      {/* Équipements déjà recensés chez le client — proposés d'emblée */}
      {recensed && <RecensedEquipments recensed={recensed} />}

      {/* Sélecteur d'équipements par catégorie */}
      <div className="space-y-4">
        {hasRecensed && (
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 border-t border-secondary-200" />
            <span className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Ajouter un équipement non recensé</span>
            <div className="flex-1 border-t border-secondary-200" />
          </div>
        )}
        {groupedTypes.map((group) => (
          <div key={group.key}>
            <h4 className="text-xs font-semibold text-secondary-500 uppercase tracking-wider mb-2">
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
                        : 'border-secondary-200 hover:border-secondary-300 hover:bg-secondary-50'
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
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-secondary-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-secondary-900'}`}>
                          {et.label}
                        </p>
                        {et.has_unit_pricing && unitPrice > 0 && (
                          <p className="text-xs text-secondary-500">
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
                            className="w-6 h-6 rounded bg-secondary-200 hover:bg-secondary-300 flex items-center justify-center transition-colors"
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
                            className="w-6 h-6 rounded bg-secondary-200 hover:bg-secondary-300 flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      <span className={`text-sm font-semibold tabular-nums ${isSelected ? 'text-blue-700' : 'text-secondary-700'}`}>
                        {isSelected && selectedItem
                          ? `${selectedItem.lineTotal?.toFixed(0) || (price + zoneSupplement).toFixed(0)}€`
                          : et.has_unit_pricing && et.included_units === 0
                            ? `${unitPrice.toFixed(0)}€/${et.unit_label}`
                            : `${(price + zoneSupplement).toFixed(0)}€`
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
      {lines.length > 0 && pricing && (
        <PricingSummary lines={lines} pricing={pricing} />
      )}

      {/* Message si aucun équipement sélectionné */}
      {lines.length === 0 && groupedTypes.length > 0 && (
        <div className="text-center py-4 text-secondary-500">
          <Wrench className="w-8 h-8 text-secondary-300 mx-auto mb-2" />
          <p className="text-sm">Sélectionnez au moins un équipement pour calculer le tarif</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RÉCAPITULATIF TARIF
// ============================================================================

function PricingSummary({ lines, pricing }) {
  return (
    <div className="p-4 bg-secondary-50 border border-secondary-200 rounded-lg space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-secondary-600" />
        <h4 className="text-sm font-semibold text-secondary-700">Récapitulatif</h4>
      </div>

      {lines.map((line) => (
        <div key={line.key} className="flex justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-secondary-600">
            {line.label}
            {line.quantity > 1 && (
              <span className="text-secondary-400 ml-1">x{line.quantity}</span>
            )}
            {line.recensed && <span className="text-secondary-400 ml-1">· déjà recensé</span>}
          </span>
          <span className="font-medium text-secondary-900 tabular-nums">{(line.lineTotal || 0).toFixed(2)}€</span>
        </div>
      ))}

      <div className="border-t border-secondary-200 pt-2 mt-2" />

      <div className="flex justify-between text-sm">
        <span className="text-secondary-600">Sous-total</span>
        <span className="font-medium text-secondary-900 tabular-nums">{pricing.subtotal.toFixed(2)}€</span>
      </div>

      {pricing.discountPercent > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-green-700 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" />
            Remise {lines.filter((l) => l.lineTotal > 0).length} équip. (-{pricing.discountPercent}%)
          </span>
          <span className="font-medium text-green-700 tabular-nums">-{pricing.discountAmount.toFixed(2)}€</span>
        </div>
      )}

      <div className="flex justify-between text-base pt-1">
        <span className="font-semibold text-secondary-900">Total annuel</span>
        <span className="font-bold text-blue-700 tabular-nums">{pricing.total.toFixed(2)}€</span>
      </div>
    </div>
  );
}

// ============================================================================
// ÉQUIPEMENTS DÉJÀ RECENSÉS
// ============================================================================

/**
 * Équipements que la fiche du client porte déjà : cochés d'office, ils seront RATTACHÉS au
 * contrat (pas recréés). Liste inconnue (chargement, échec) ⇒ on le dit et l'étape reste
 * bloquée par la modale : avancer sans elle recréerait des doublons.
 */
function RecensedEquipments({ recensed }) {
  const { lines, isLoading, error, onToggle, onRetry } = recensed;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-secondary-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Lecture des équipements déjà recensés…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start justify-between gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-800">
          Les équipements déjà recensés chez ce client n&apos;ont pas pu être lus. Le contrat ne peut pas
          être créé sans eux : ils seraient recréés en double.
        </p>
        <button
          type="button"
          onClick={() => onRetry?.()}
          className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-800 bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Réessayer
        </button>
      </div>
    );
  }

  if (lines.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-secondary-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <ClipboardCheck className="w-3.5 h-3.5" />
        Déjà recensés chez ce client
      </h4>
      <div className="space-y-1.5">
        {lines.map((line) => {
          const sansType = !line.equipmentTypeId;
          return (
            <label
              key={line.equipmentId}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all duration-150 ${
                line.included ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-secondary-200 hover:border-secondary-300 hover:bg-secondary-50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={line.included}
                  onChange={() => onToggle(line.equipmentId)}
                  className="h-5 w-5 shrink-0 rounded border-secondary-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${line.included ? 'text-blue-900' : 'text-secondary-900'}`}>
                    {sansType ? 'Équipement sans type' : line.labelWithUnits}
                  </p>
                  {(line.reference || sansType) && (
                    <p className="text-xs text-secondary-500 truncate">
                      {[line.reference, sansType ? 'type à renseigner dans l’onglet Équipements pour le chiffrer' : null].filter(Boolean).join(' — ')}
                    </p>
                  )}
                </div>
              </div>
              <span className={`text-sm font-semibold tabular-nums shrink-0 ${line.included ? 'text-blue-700' : 'text-secondary-700'}`}>
                {sansType ? 'non chiffré' : `${(line.lineTotal || 0).toFixed(0)}€`}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-secondary-500">
        Les équipements cochés sont rattachés au contrat tels qu&apos;ils sont sur la fiche. Décochez ceux qui restent hors contrat.
      </p>
    </div>
  );
}
