/**
 * ContractPricingSection.jsx
 * ============================================================================
 * Section tarification dans TabContrat.
 * Calcule automatiquement le prix à partir des équipements liés au contrat
 * (contract_equipments) + zone tarifaire + grille de prix.
 *
 * @version 2.0.0 - Calcul auto depuis équipements sous contrat
 * ============================================================================
 */

import { useMemo, useCallback, useEffect } from 'react';
import { Loader2, Calculator, Tag, AlertTriangle, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData, useContractLineOverrides } from '@hooks/usePricing';
import { useContractZone } from '@hooks/useContractZone';
import { contractKeys } from '@hooks/cacheKeys';
import {
  calculateLineTotal,
  calculateContractTotal,
  pricingService,
} from '@services/pricing.service';
import { formatEuro } from '@/lib/utils';

export function ContractPricingSection({ contractId, contract, client }) {
  const queryClient = useQueryClient();
  const { isOrgAdmin, organization } = useAuth();
  const orgId = organization?.id;
  const { equipments, isLoading: loadingEquipments } = useContractEquipments(contractId);
  const { zones, rates, discounts, equipmentTypes, isLoading: loadingPricing } = usePricingData();
  const { overrides, setOverride, clearOverride, isSaving: isSavingOverrides } = useContractLineOverrides(contractId);

  // Zone tarifaire : stockée → Mapbox (temps trajet) → fallback CP dept → défaut
  const { activeZone, isDetecting: isDetectingZone, durationMinutes } = useContractZone(
    client,
    contract,
    zones
  );

  // Index tarifs : zone_id + equipment_type_id → rate
  const rateIndex = useMemo(() => {
    if (!rates) return {};
    const idx = {};
    for (const r of rates) {
      const zId = r.zone_id || r.zone?.id;
      const etId = r.equipment_type_id || r.equipment_type?.id;
      if (zId && etId) idx[`${zId}_${etId}`] = r;
    }
    return idx;
  }, [rates]);

  // Map des equipment types
  const equipTypeMap = useMemo(() => {
    const map = {};
    for (const et of equipmentTypes || []) map[et.id] = et;
    return map;
  }, [equipmentTypes]);

  // Supplément zone (déplacement) — ajouté une fois par ligne d'équipement
  const zoneSupplement = parseFloat(activeZone?.supplement || 0);

  // Calcul pricing à partir des équipements sous contrat
  // Chaque équipement = 1 item (pas de groupement) → 1 item = 1 équipement pour la remise
  // Note : les splits (unit_pricing) comptent comme 1 seul équipement
  const computedPricing = useMemo(() => {
    if (!equipments?.length || !activeZone) return null;

    let unmapped = 0;
    const items = [];

    for (const eq of equipments) {
      const etId = eq.equipment_type_id;
      if (!etId) {
        unmapped++;
        continue;
      }
      const rate = rateIndex[`${activeZone.id}_${etId}`] || null;
      const equipType = equipTypeMap[etId] || null;
      const unitCount = eq.unit_count || 1;
      const gridPrice = calculateLineTotal(rate, equipType, unitCount, zoneSupplement);
      // Prix forcé par ligne (override) → substitue le prix grille ; la dégressivité
      // s'applique ensuite normalement sur le sous-total (cf. calculateContractTotal).
      const ov = overrides?.[eq.id];
      const isForced = ov != null;
      const lineTotal = isForced ? ov : gridPrice;
      const refParts = [eq.brand, eq.model].filter(Boolean);
      const unitLabel = unitCount > 1 && equipType?.unit_label ? ` (${unitCount} ${equipType.unit_label}s)` : '';

      items.push({
        equipmentId: eq.id,
        equipmentTypeId: etId,
        zoneId: activeZone.id,
        basePrice: rate ? parseFloat(rate.price) : 0,
        unitPrice: rate?.unit_price != null ? parseFloat(rate.unit_price) : 0,
        quantity: 1,
        label: (equipType?.label || 'Équipement') + unitLabel,
        reference: refParts.length > 0 ? refParts.join(' ') : null,
        gridPrice,
        isForced,
        lineTotal,
      });
    }

    const totals = calculateContractTotal(items, discounts);
    return { items, unmapped, ...totals };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts, zoneSupplement, overrides]);

  // Vérifier si le montant du contrat correspond au calcul
  const currentAmount = contract?.amount ? parseFloat(contract.amount) : 0;
  const calculatedTotal = computedPricing?.total || 0;
  const amountMismatch = computedPricing && computedPricing.items.length > 0 && Math.abs(currentAmount - calculatedTotal) > 0.01;
  const isForced = !!contract?.amount_forced;
  const hasOverrides = !!overrides && Object.keys(overrides).length > 0;

  // Auto-sync silencieux : aligne `amount` sur le calcul (prix forcés par ligne + dégressivité inclus).
  // Un contrat legacy en mode global-forcé (`amount_forced=true`) est préservé tant qu'aucun prix de
  // ligne n'a été posé ; dès qu'un override existe, on bascule sur le calcul (amount_forced → false).
  useEffect(() => {
    if (!computedPricing || !amountMismatch) return;
    if (isForced && !hasOverrides) return; // legacy global force préservé
    // Fire-and-forget : pas de toast, juste l'alignement silencieux
    (async () => {
      try {
        await pricingService.updateContractAmount(
          contractId,
          computedPricing,
          activeZone?.id,
          false
        );
        queryClient.invalidateQueries({ queryKey: contractKeys.all(orgId) });
      } catch (err) {
        console.warn('[ContractPricingSection] auto-sync silent fail:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMismatch, isForced, hasOverrides, contractId, activeZone?.id, computedPricing?.total]);

  // Forçage du prix d'une ligne d'équipement (admin) — override par equipment_id.
  // Le total se réaligne ensuite via l'auto-sync (amount = somme des lignes − dégressivité).
  const handleLinePriceCommit = useCallback(async (item, rawValue) => {
    const parsed = parseFloat(String(rawValue).replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) return;
    const value = Math.round(parsed * 100) / 100;
    // Valeur = prix grille → on retire l'override (retour grille)
    if (Math.abs(value - item.gridPrice) < 0.01) {
      if (item.isForced) {
        try {
          await clearOverride(item.equipmentId);
          toast.success('Ligne réalignée sur le prix grille');
        } catch (err) {
          console.error('[ContractPricingSection] clear line override:', err);
          toast.error('Erreur lors de la réinitialisation');
        }
      }
      return;
    }
    // Inchangé vs override courant → no-op
    if (item.isForced && Math.abs(value - item.lineTotal) < 0.01) return;
    try {
      await setOverride(
        {
          equipmentId: item.equipmentId,
          equipmentTypeId: item.equipmentTypeId,
          zoneId: item.zoneId,
          basePrice: item.basePrice,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        },
        value
      );
      toast.success('Prix de la ligne forcé');
    } catch (err) {
      console.error('[ContractPricingSection] set line override:', err);
      toast.error('Erreur lors du forçage du prix');
    }
  }, [setOverride, clearOverride]);

  const handleClearLine = useCallback(async (item) => {
    try {
      await clearOverride(item.equipmentId);
      toast.success('Ligne réalignée sur le prix grille');
    } catch (err) {
      console.error('[ContractPricingSection] clear line override:', err);
      toast.error('Erreur lors de la réinitialisation');
    }
  }, [clearOverride]);

  const isLoading = loadingEquipments || loadingPricing;

  if (isLoading) {
    return (
      <div className="pt-6 border-t border-secondary-200">
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
        </h4>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
        </div>
      </div>
    );
  }

  // Aucun équipement lié au contrat
  if (!equipments?.length) {
    return (
      <div className="pt-6 border-t border-secondary-200">
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
        </h4>
        <p className="text-sm text-secondary-500 italic py-2">
          Associez des équipements au contrat depuis l'onglet Équipements pour calculer le tarif.
        </p>
      </div>
    );
  }

  // Zone non déterminée
  if (!activeZone) {
    return (
      <div className="pt-6 border-t border-secondary-200">
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
        </h4>
        <p className="text-sm text-amber-600 py-2">
          Zone tarifaire non déterminée. Renseignez l'adresse du client pour calculer le tarif.
        </p>
      </div>
    );
  }

  // Aucun item calculable (tous les équipements sans equipment_type_id)
  if (!computedPricing || computedPricing.items.length === 0) {
    return (
      <div className="pt-6 border-t border-secondary-200">
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
        </h4>
        <p className="text-sm text-amber-600 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Les équipements sous contrat n'ont pas de type tarifaire associé. Modifiez les équipements pour renseigner leur type.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-6 border-t border-secondary-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2 flex-wrap">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
          <span className="text-xs font-normal text-secondary-500">
            ({activeZone.label}
            {durationMinutes != null ? ` · ${durationMinutes} min de trajet` : ''})
          </span>
          {isDetectingZone && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-secondary-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Calcul du temps de trajet…
            </span>
          )}
        </h4>
      </div>

      <div className="bg-secondary-50 rounded-lg p-4 space-y-1.5">
        {computedPricing.items.map((item) => (
          <div key={item.equipmentId} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-secondary-700 min-w-0 truncate">
              {item.label}
              {item.reference && (
                <span className="text-secondary-400 ml-1">— {item.reference}</span>
              )}
            </span>
            {isOrgAdmin ? (
              <div className="flex items-center gap-1.5 shrink-0">
                {item.isForced && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] text-amber-600"
                    title={`Prix grille : ${formatEuro(item.gridPrice)}`}
                  >
                    <Lock className="w-3 h-3" /> forcé
                  </span>
                )}
                <input
                  key={`${item.equipmentId}-${item.lineTotal}`}
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={item.lineTotal}
                  onBlur={(e) => handleLinePriceCommit(item, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  disabled={isSavingOverrides}
                  className={`w-20 px-1.5 py-0.5 border rounded text-right tabular-nums text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 ${
                    item.isForced
                      ? 'border-amber-300 text-amber-700 font-medium bg-amber-50'
                      : 'border-secondary-200 text-secondary-900 bg-white'
                  }`}
                />
                <span className="text-secondary-400 text-xs">€</span>
                {item.isForced ? (
                  <button
                    onClick={() => handleClearLine(item)}
                    disabled={isSavingOverrides}
                    title="Revenir au prix grille"
                    className="p-0.5 text-secondary-400 hover:text-secondary-700 disabled:opacity-50"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="w-[18px]" aria-hidden />
                )}
              </div>
            ) : (
              <span className="font-medium text-secondary-900 tabular-nums">
                {formatEuro(item.lineTotal)}
              </span>
            )}
          </div>
        ))}

        {computedPricing.unmapped > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 pt-1">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {computedPricing.unmapped} équipement{computedPricing.unmapped > 1 ? 's' : ''} sans type tarifaire
          </div>
        )}

        <div className="border-t border-secondary-200 pt-2 mt-2 space-y-1">
          {computedPricing.subtotal !== computedPricing.total && (
            <div className="flex justify-between text-sm">
              <span className="text-secondary-500">Sous-total</span>
              <span className="text-secondary-700 tabular-nums">{formatEuro(computedPricing.subtotal)}</span>
            </div>
          )}
          {computedPricing.discountPercent > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-700 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" />
                Remise -{computedPricing.discountPercent}%
              </span>
              <span className="text-green-700 tabular-nums">
                -{formatEuro(computedPricing.discountAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold">
            <span className="text-secondary-900">Total annuel</span>
            <span className="text-primary-700 tabular-nums">{formatEuro(computedPricing.total)}</span>
          </div>

          {isForced && !hasOverrides && amountMismatch && (
            <div className="flex items-center justify-between gap-2 text-xs pt-1.5 mt-1 border-t border-dashed border-amber-200 text-amber-700">
              <span className="inline-flex items-center gap-1 min-w-0">
                <Lock className="w-3 h-3 shrink-0" />
                <span className="truncate">Montant facturé hérité — modifie une ligne pour repasser au calcul</span>
              </span>
              <span className="tabular-nums font-semibold whitespace-nowrap">{formatEuro(currentAmount)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
