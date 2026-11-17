/**
 * chantierCardDate.js — ce que porte la bande de gauche d'une carte chantier.
 * ============================================================================
 * Module PUR (aucun import). La bande dépend de la COLONNE où la carte est posée.
 *
 * Règle (Eric, 2026-11-17) :
 *   Gagné            → passage en gagné (signature du devis)
 *   Commande à faire → aucune date : l'acompte est versé, il reste à commander
 *   À planifier      → aucune date : commandes reçues, pose pas encore datée
 *   Planifié         → début de l'intervention posée au planning
 *   Réceptionné      → réception du chantier (date de réalisation)
 *
 * Une date inconnue reste `null` : la carte affiche une icône, jamais une autre
 * date à la place (une date de signature dans la colonne « À planifier » se lisait
 * comme une date de pose).
 * ============================================================================
 */

/**
 * @typedef {Object} BandeDeCarte
 * @property {string|null} date  `YYYY-MM-DD`, `null` quand la colonne n'a pas de date ou qu'elle est inconnue
 * @property {string} libelle    ce que la bande représente (infobulle)
 * @property {'date'|'commande'|'a_planifier'|'a_replanifier'|'inconnue'} repere
 *           `date` : jour et mois ; les autres : une icône
 */

/**
 * @param {Object|null|undefined} chantier ligne de `majordhome_chantiers`
 * @returns {BandeDeCarte}
 */
export function bandeDeCarteChantier(chantier) {
  if (!chantier) return { date: null, libelle: '', repere: 'inconnue' };

  const avecDate = (date, libelle, sinon) => (date
    ? { date, libelle, repere: 'date' }
    : { date: null, libelle: sinon, repere: 'inconnue' });

  switch (chantier.chantier_status) {
    case 'gagne':
      return avecDate(chantier.won_date, 'Gagné le', 'Date de signature inconnue');

    case 'commande_a_faire':
      return { date: null, libelle: 'Acompte versé : commandes à passer', repere: 'commande' };

    case 'commande_recue':
      return { date: null, libelle: 'Commandes reçues : pose à dater', repere: 'a_planifier' };

    case 'planification':
      if (!chantier.has_active_rdv || !chantier.next_rdv_date) {
        return { date: null, libelle: 'Installation à replanifier', repere: 'a_replanifier' };
      }
      return { date: chantier.next_rdv_date, libelle: 'Début de la pose', repere: 'date' };

    case 'realise':
    case 'facture':
      return avecDate(chantier.realized_date, 'Réceptionné le', 'Date de réception inconnue');

    default:
      return avecDate(chantier.won_date, 'Gagné le', 'Date inconnue');
  }
}

const RANG = { a_replanifier: 0, date: 1 };
const rang = (bande) => RANG[bande.repere] ?? 2;

/**
 * Ordre des cartes dans une colonne : d'abord celles à replanifier (un geste est
 * attendu), puis les cartes datées de la plus récente à la plus ancienne, puis les
 * cartes sans date, de la signature la plus récente à la plus ancienne.
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export function comparerCartesChantier(a, b) {
  const ba = bandeDeCarteChantier(a);
  const bb = bandeDeCarteChantier(b);
  const ecart = rang(ba) - rang(bb);
  if (ecart !== 0) return ecart;
  if (ba.date && bb.date && ba.date !== bb.date) return bb.date.localeCompare(ba.date);
  return (b?.won_date || '').localeCompare(a?.won_date || '');
}

/**
 * Adresse d'une carte sur deux lignes : la voie, puis « code postal ville ».
 * Une ligne absente vaut chaîne vide (la carte garde sa hauteur).
 * @param {{ address?: string|null, postal_code?: string|null, city?: string|null }|null|undefined} chantier
 * @returns {{ voie: string, commune: string }}
 */
export function adresseDeCarte(chantier) {
  const propre = (v) => (v || '').replace(/\s+/g, ' ').trim();
  return {
    voie: propre(chantier?.address),
    commune: [propre(chantier?.postal_code), propre(chantier?.city)].filter(Boolean).join(' '),
  };
}

/**
 * Objet du chantier sur une ligne : type d'équipement, puis libellé saisi
 * (sans répéter le libellé s'il dit la même chose que le type).
 * @param {{ equipment_type_label?: string|null, label?: string|null }|null|undefined} chantier
 * @returns {string}
 */
export function objetDeCarte(chantier) {
  const type = (chantier?.equipment_type_label || '').trim();
  const libelle = (chantier?.label || '').trim();
  if (type && libelle && type.toLowerCase() === libelle.toLowerCase()) return type;
  return [type, libelle].filter(Boolean).join(' · ');
}
