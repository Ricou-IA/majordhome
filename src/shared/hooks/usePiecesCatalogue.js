/**
 * usePiecesCatalogue.js — Pièces des catalogues de marchands pour la marque d'un appareil
 * ============================================================================
 * Une seule lecture par marque (cache 10 min) : le filtre de saisie et le classement par modèle se font ensuite
 * côté écran sur LES MÊMES objets (le classement garde un index par objet-ligne). `lignes` garde une référence
 * stable tant que la requête ne change pas. Marque inexploitable : aucune requête (`enabled` faux).
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { piecesCatalogueService } from '@services/piecesCatalogue.service';
import { piecesCatalogueKeys } from '@hooks/cacheKeys';
import { motFiltreMarque, motFiltreModele } from '@/lib/catalogue/piecesCatalogueRequete';

/**
 * @param {{ brand?: string|null, model?: string|null }|null|undefined} equipment
 * @returns {{ lignes: object[]|undefined, tronque: boolean, ciblee: boolean, aMotModele: boolean,
 *   isLoading: boolean, error: unknown, aMarque: boolean }}
 */
export function usePiecesCatalogue(equipment) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const marque = equipment?.brand ?? '';
  const modele = equipment?.model ?? '';
  const mot = motFiltreMarque(marque);
  const motModele = motFiltreModele(modele, marque);
  const { data, isLoading, error } = useQuery({
    queryKey: piecesCatalogueKeys.parMarque(orgId, mot, motModele),
    queryFn: async () => {
      const { data: lues, error: err } = await piecesCatalogueService.listerPourMarque(orgId, marque, modele);
      if (err) throw err;
      return lues;
    },
    enabled: !!orgId && !!mot,
    staleTime: 10 * 60 * 1000,
    retry: 1, // une vue absente ou un droit refusé ne doit pas laisser « Chargement… » plusieurs secondes
  });
  return {
    lignes: data?.lignes, tronque: data?.tronque === true, ciblee: data?.ciblee === true, aMotModele: !!motModele,
    isLoading: !!orgId && !!mot && isLoading, error, aMarque: !!mot,
  };
}
