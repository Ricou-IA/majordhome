import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { logger } from '@lib/logger';
import { motFiltreMarque, motFiltreModele, fusionnerLectures } from '@/lib/catalogue/piecesCatalogueRequete';

/**
 * Pièces détachées des catalogues de marchands relevés (vue `majordhome_pieces_catalogue`, lecture seule,
 * security_invoker). Les colonnes lues sont celles dont l'écran et le classement (`classerPieces`) ont besoin,
 * `recherche` comprise. Spec : 2026-11-12-base-pieces-catalogues-marchands-design.md § 3.
 */
const COLONNES = 'id, supplier_name, reference, name, brand, rayons, prix_public_ttc, en_stock, releve_at, fiche_url, recherche';

/** Plafond de chaque lecture : le classement et le filtre de saisie se font ensuite côté écran, sans nouvel appel. */
export const LIMITE_LECTURE = 500;

/**
 * Une lecture bornée et ordonnée (référence puis id : même ordre à chaque appel). Filtre de marque sur `marque_recherche`
 * (marque + rayons, minuscules, sans accents ; non sélectionnée : elle ne sert qu'au filtre), et du modèle si `motModele` est donné.
 */
async function lire(orgId, motMarque, motModele) {
  let q = supabase.from('majordhome_pieces_catalogue').select(COLONNES).eq('org_id', orgId).ilike('marque_recherche', `%${motMarque}%`);
  if (motModele) q = q.ilike('recherche', `%${motModele}%`);
  const { data, error } = await q.order('reference', { ascending: true }).order('id', { ascending: true }).limit(LIMITE_LECTURE);
  if (error) throw error;
  return data || [];
}

export const piecesCatalogueService = {
  /**
   * Pièces dont la marque ou les rayons (colonne normalisée `marque_recherche`) portent le premier mot utile de la marque (sur-ensemble ; le classement fin est celui de
   * `classerPieces`). Marque inexploitable → liste vide, sans requête.
   *
   * Troncature : si la lecture par marque atteint la limite, `tronque` est vrai et, quand le modèle a un mot de
   * filtre, une SECONDE lecture ciblée (marque + mot du modèle) ramène les pièces qui le citent ; les deux listes
   * sont fusionnées sans doublon (par `id`). Seconde lecture en erreur : erreur journalisée, première liste gardée.
   * `ciblee` est vrai seulement si cette seconde lecture a abouti sans être elle-même tronquée.
   * @param {string} orgId
   * @param {string} marque
   * @param {string} [modele]
   * @returns {Promise<{ data: { lignes: object[], tronque: boolean, ciblee: boolean }|null, error: unknown }>}
   */
  listerPourMarque(orgId, marque, modele = '') {
    return withErrorHandling(async () => {
      const motMarque = motFiltreMarque(marque);
      if (!orgId || !motMarque) return { lignes: [], tronque: false, ciblee: false };

      const premiere = await lire(orgId, motMarque, '');
      const motModele = motFiltreModele(modele, marque);
      if (premiere.length < LIMITE_LECTURE || !motModele) return fusionnerLectures(premiere, null, LIMITE_LECTURE);

      try {
        return fusionnerLectures(premiere, await lire(orgId, motMarque, motModele), LIMITE_LECTURE);
      } catch (err) {
        logger.error('[piecesCatalogue.listerPourMarque] lecture ciblée sur le modèle en échec', err);
        return fusionnerLectures(premiere, null, LIMITE_LECTURE);
      }
    }, 'piecesCatalogue.listerPourMarque');
  },
};
