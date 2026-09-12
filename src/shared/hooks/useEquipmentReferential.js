/**
 * useEquipmentReferential.js - Majord'home Artisan
 * ============================================================================
 * Référentiel équipements de l'org courante pour les écrans : catégories
 * actives + types actifs, indexés par src/lib/equipmentReferential.js.
 *
 * Point unique de vocabulaire (libellés de catégorie / type, regroupement des
 * sélecteurs, gabarit de certificat). Remplace les constantes locales
 * d'étiquettes (enum, familles) supprimées en 2026-09.
 *
 * Cache : pricingKeys.categories(orgId, true) + clientKeys.pricingTypes(orgId).
 * usePricingAdmin invalide les deux familles après chaque mutation (catégorie
 * ou type) : un type re-catégorisé dans Settings se regroupe aussitôt ailleurs.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { clientKeys, pricingKeys } from '@hooks/cacheKeys';
import { clientsService } from '@services/clients.service';
import { equipmentCategoriesService } from '@services/equipmentCategories.service';
import { indexReferentiel } from '@/lib/equipmentReferential';

const STALE = 10 * 60 * 1000; // données quasi statiques

/**
 * @returns {{ categories: Array, equipmentTypes: Array, index: ReturnType<typeof indexReferentiel>, isLoading: boolean, error: Error|null }}
 */
export function useEquipmentReferential() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const categoriesQuery = useQuery({
    queryKey: pricingKeys.categories(orgId, true),
    queryFn: async () => {
      const { data, error } = await equipmentCategoriesService.getCategories(orgId, { activeOnly: true });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: STALE,
  });

  const typesQuery = useQuery({
    queryKey: clientKeys.pricingTypes(orgId),
    queryFn: async () => {
      const { data, error } = await clientsService.getPricingEquipmentTypes(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: STALE,
  });

  const categories = categoriesQuery.data;
  const equipmentTypes = typesQuery.data;
  const index = useMemo(
    () => indexReferentiel({ categories: categories || [], equipmentTypes: equipmentTypes || [] }),
    [categories, equipmentTypes],
  );

  return {
    categories: categories || [],
    equipmentTypes: equipmentTypes || [],
    index,
    isLoading: categoriesQuery.isLoading || typesQuery.isLoading,
    error: categoriesQuery.error || typesQuery.error || null,
  };
}

export default useEquipmentReferential;
