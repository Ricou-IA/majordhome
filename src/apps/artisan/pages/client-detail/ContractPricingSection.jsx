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

import { useMemo, useState, useCallback } from 'react';
import { Loader2, Calculator, RefreshCw, Tag, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
import { contractKeys } from '@hooks/cacheKeys';
import {
  calculateLineTotal,
  calculateContractTotal,
  pricingService,
} from '@services/pricing.service';
import { formatEuro } from '@/lib/utils';

export function ContractPricingSection({ contractId, contract, client }) {
  const queryClient = useQueryClient();
  const { equipments, isLoading: loadingEquipments } = useContractEquipments(contractId);
  const { zones, rates, discounts, equipmentTypes, isLoading: loadingPricing } = usePricingData();
  const [isSyncing, setIsSyncing] = useState(false);

  // Déterminer la zone tarifaire (contrat > fallback zone par défaut)
  const activeZone = useMemo(() => {
    if (contract?.zone_id && zones?.length) {
      return zones.find((z) => z.id === contract.zone_id) || null;
    }
    // Fallback : zone par défaut (Hors Zone) pour contrats importés sans zone_id
    if (zones?.length) {
      return zones.find((z) => z.is_default && z.is_active) || null;
    }
    return null;
  }, [contract?.zone_id, zones]);

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
      const lineTotal = calculateLineTotal(rate, equipType, unitCount, zoneSupplement);
      const refParts = [eq.brand, eq.model].filter(Boolean);
      const unitLabel = unitCount > 1 && equipType?.unit_label ? ` (${unitCount} ${equipType.unit_label}s)` : '';

      items.push({
        equipmentTypeId: etId,
        label: (equipType?.label || 'Équipement') + unitLabel,
        reference: refParts.length > 0 ? refParts.join(' ') : null,
        quantity: 1,
        lineTotal,
      });
    }

    const totals = calculateContractTotal(items, discounts);
    return { items, unmapped, ...totals };
  }, [equipments, activeZone, rateIndex, equipTypeMap, discounts, zoneSupplement]);

  // Vérifier si le montant du contrat correspond au calcul
  const currentAmount = contract?.amount ? parseFloat(contract.amount) : 0;
  const calculatedTotal = computedPricing?.total || 0;
  const amountMismatch = computedPricing && computedPricing.items.length > 0 && Math.abs(currentAmount - calculatedTotal) > 0.01;

  // Synchroniser le montant du contrat
  const handleSync = useCallback(async () => {
    if (!computedPricing || isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await pricingService.updateContractAmount(
        contractId,
        computedPricing,
        activeZone?.id
      );
      if (result.error) throw result.error;
      toast.success('Montant du contrat mis à jour');
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    } catch (err) {
      console.error('[ContractPricingSection] sync error:', err);
      toast.error('Erreur lors de la mise à jour du montant');
    } finally {
      setIsSyncing(false);
    }
  }, [computedPricing, contractId, activeZone, isSyncing, queryClient]);

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
        <h4 className="text-sm font-semibold text-secondary-900 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-secondary-500" />
          Tarification
          <span className="text-xs font-normal text-secondary-500">
            ({activeZone.label})
          </span>
        </h4>
        {amountMismatch && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Mettre à jour le montant
          </button>
        )}
      </div>

      <div className="bg-secondary-50 rounded-lg p-4 space-y-1.5">
        {computedPricing.items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between text-sm">
            <span className="text-secondary-700">
              {item.label}
              {item.reference && (
                <span className="text-secondary-400 ml-1">— {item.reference}</span>
              )}
            </span>
            <span className="font-medium text-secondary-900 tabular-nums">
              {formatEuro(item.lineTotal)}
            </span>
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
        </div>
      </div>
    </div>
  );
}
