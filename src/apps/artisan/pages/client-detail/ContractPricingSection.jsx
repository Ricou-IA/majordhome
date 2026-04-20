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

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Loader2, Calculator, Tag, AlertTriangle, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { useContractEquipments } from '@hooks/useContracts';
import { usePricingData } from '@hooks/usePricing';
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
  const { isOrgAdmin } = useAuth();
  const { equipments, isLoading: loadingEquipments } = useContractEquipments(contractId);
  const { zones, rates, discounts, equipmentTypes, isLoading: loadingPricing } = usePricingData();
  const [isSyncing, setIsSyncing] = useState(false);
  const [forcedInput, setForcedInput] = useState('');
  const [isSavingForced, setIsSavingForced] = useState(false);

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
  const isForced = !!contract?.amount_forced;

  // Pré-remplir l'input "Forcer valeur" avec le montant stocké quand le contrat est en mode forcé
  useEffect(() => {
    if (isForced && currentAmount > 0) {
      setForcedInput(String(currentAmount));
    } else {
      setForcedInput('');
    }
  }, [currentAmount, isForced]);

  // Synchroniser le montant du contrat sur la valeur calculée (amount_forced = false)
  const handleSync = useCallback(async () => {
    if (!computedPricing || isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await pricingService.updateContractAmount(
        contractId,
        computedPricing,
        activeZone?.id,
        false
      );
      if (result.error) throw result.error;
      toast.success('Montant aligné sur le calcul');
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    } catch (err) {
      console.error('[ContractPricingSection] sync error:', err);
      toast.error('Erreur lors de la mise à jour du montant');
    } finally {
      setIsSyncing(false);
    }
  }, [computedPricing, contractId, activeZone, isSyncing, queryClient]);

  // Auto-sync silencieux à l'ouverture : si mismatch ET pas forcé → aligner sur calcul
  useEffect(() => {
    if (!computedPricing || isForced || !amountMismatch || isSyncing) return;
    // Fire-and-forget : pas de toast, juste l'alignement silencieux
    (async () => {
      try {
        await pricingService.updateContractAmount(
          contractId,
          computedPricing,
          activeZone?.id,
          false
        );
        queryClient.invalidateQueries({ queryKey: contractKeys.all });
      } catch (err) {
        console.warn('[ContractPricingSection] auto-sync silent fail:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMismatch, isForced, contractId, activeZone?.id, computedPricing?.total]);

  // Forcer un montant saisi manuellement (org_admin uniquement) — amount_forced = true
  const handleSaveForced = useCallback(async () => {
    const value = parseFloat(forcedInput);
    if (!computedPricing || isSavingForced || isNaN(value) || value < 0) return;
    setIsSavingForced(true);
    try {
      const forcedPricing = {
        total: value,
        subtotal: computedPricing.subtotal,
        discountPercent: computedPricing.discountPercent,
      };
      const result = await pricingService.updateContractAmount(
        contractId,
        forcedPricing,
        activeZone?.id,
        true
      );
      if (result.error) throw result.error;
      toast.success('Valeur forcée enregistrée');
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
    } catch (err) {
      console.error('[ContractPricingSection] force error:', err);
      toast.error('Erreur lors de l\'enregistrement');
    } finally {
      setIsSavingForced(false);
    }
  }, [forcedInput, computedPricing, contractId, activeZone, isSavingForced, queryClient]);

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
            <span className="text-secondary-900">Total annuel (calculé)</span>
            <span className="text-primary-700 tabular-nums">{formatEuro(computedPricing.total)}</span>
          </div>

          {isForced && (
            <div className="flex justify-between text-sm font-semibold pt-1">
              <span className="text-amber-700 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" />
                Montant facturé (forcé)
              </span>
              <span className="text-amber-700 tabular-nums">{formatEuro(currentAmount)}</span>
            </div>
          )}
        </div>
      </div>

      {isOrgAdmin && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <label className="text-secondary-600 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-secondary-400" />
            Forcer la valeur
          </label>
          <input
            type="number"
            step="1"
            min="0"
            value={forcedInput}
            onChange={(e) => setForcedInput(e.target.value)}
            placeholder={String(computedPricing.total)}
            className="w-24 px-2 py-1 border border-secondary-300 rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-secondary-500">€</span>
          <button
            onClick={handleSaveForced}
            disabled={isSavingForced || !forcedInput}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors disabled:opacity-50"
          >
            {isSavingForced ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
          {isForced && (
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-md transition-colors disabled:opacity-50"
              title="Supprimer le forçage et aligner sur le calcul"
            >
              {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
              Aligner sur calcul
            </button>
          )}
        </div>
      )}
    </div>
  );
}
