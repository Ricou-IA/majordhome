// src/lib/catalogue/piecesAffichage.js
// Textes d'affichage du bloc « Dans les catalogues de vos fournisseurs » (fenêtre « Trouver une pièce »).
// Module PUR, sans import : la date du jour est injectable pour les tests.

const JOUR_MS = 24 * 60 * 60 * 1000;
const AGE_ANNEE_JOURS = 300;
const AGE_AFFICHE_JOURS = 7;

const deuxChiffres = (n) => String(n).padStart(2, '0');

/**
 * Date d'un relevé pour l'écran, toujours à côté du prix et du stock :
 * « au relevé du 12/11 », avec l'année quand le relevé a plus de 300 jours ou n'est pas de l'année en cours
 * (« au relevé du 12/11/2025 »), et « (il y a N jours) » au-delà de 7 jours. Date absente ou illisible : « relevé non daté ».
 * @param {unknown} iso   date ISO du relevé
 * @param {Date} [maintenant]
 * @returns {string}
 */
export function libelleDateReleve(iso, maintenant = new Date()) {
  if (typeof iso !== 'string' || !iso) return 'relevé non daté';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'relevé non daté';
  const jours = Math.floor((maintenant.getTime() - d.getTime()) / JOUR_MS);
  const avecAnnee = jours > AGE_ANNEE_JOURS || d.getFullYear() !== maintenant.getFullYear();
  const date = `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}${avecAnnee ? `/${d.getFullYear()}` : ''}`;
  return `au relevé du ${date}${jours > AGE_AFFICHE_JOURS ? ` (il y a ${jours} jours)` : ''}`;
}

/**
 * Phrase du bloc quand la saisie ne retient aucune pièce alors que le catalogue en a pour cet appareil.
 * @param {{ citees: number, memeMarque: number }} total  effectifs avant filtre
 * @returns {string}
 */
export function messageSaisieSansResultat(total) {
  const citees = total?.citees || 0;
  const n = citees > 0 ? citees : total?.memeMarque || 0;
  const pluriel = n > 1 ? 's' : '';
  const suite = citees > 0 ? `pièce${pluriel} citée${pluriel} pour ce modèle` : `pièce${pluriel} de la marque`;
  return `Aucune pièce ne correspond à cette saisie. ${n} ${suite} sans filtre :`;
}
