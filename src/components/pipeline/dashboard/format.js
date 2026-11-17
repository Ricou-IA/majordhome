/**
 * format.js — mise en forme des chiffres du Dashboard du pipeline (aucun calcul ici :
 * les chiffres viennent de `src/lib/pipelineDashboard.js`).
 */

import { formatEuroCeil } from '@lib/utils';

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** `2026-11` → « nov. 2026 » */
export function libelleMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return `${MOIS_COURTS[m - 1]} ${a}`;
}

/** `2026-11` → « nov. » */
export function libelleMoisCourt(mois) {
  return MOIS_COURTS[Number(mois.split('-')[1]) - 1];
}

/** Une période : « Novembre 2026 », ou « sept. → nov. 2026 » pour plusieurs mois. */
export function libellePeriode(mois) {
  if (!mois?.length) return '';
  const tries = [...mois].sort();
  if (tries.length === 1) {
    const [a, m] = tries[0].split('-').map(Number);
    return `${MOIS_LONGS[m - 1]} ${a}`;
  }
  return `${libelleMoisCourt(tries[0])} → ${libelleMois(tries.at(-1))}`;
}

/** Ce à quoi la période est comparée : « oct. » ou « la période précédente ». */
export function libelleComparaison(precedente) {
  return precedente?.length === 1 ? libelleMoisCourt(precedente[0]) : 'la période précédente';
}

export const entier = (n) => (Number(n) || 0).toLocaleString('fr-FR');
export const euros = (n) => formatEuroCeil(Number(n) || 0);

/** Écart signé entre deux valeurs : « +3 », « −2 », « = ». */
export function ecartSigne(actuel, precedent, formater = entier) {
  const diff = (Number(actuel) || 0) - (Number(precedent) || 0);
  if (diff === 0) return '=';
  return `${diff > 0 ? '+' : '−'}${formater(Math.abs(diff))}`;
}

/**
 * « Gagnés à 30 jours » d'une mesure : la valeur à afficher et sa précision.
 * Une période en cours n'a pas de taux : on affiche le décompte.
 * @returns {{ valeur: string, detail: string }}
 */
export function gagnes30(mesure) {
  if (!mesure || mesure.leads === 0) return { valeur: '—', detail: 'aucun lead reçu' };
  const surTotal = `${entier(mesure.gagnes30)} sur ${entier(mesure.leads)}`;
  if (mesure.etat === 'en_cours') return { valeur: entier(mesure.gagnes30), detail: 'en cours' };
  const taux = `${Math.round(mesure.tauxGagnes30)} %`;
  return { valeur: taux, detail: mesure.etat === 'provisoire' ? `${surTotal} · provisoire` : surTotal };
}

/** Délai de signature : « 12 j », ou « — » sans vente mesurable. */
export function delai(mesure) {
  if (!mesure || mesure.delaiSignature === null) return '—';
  return `${Math.round(mesure.delaiSignature)} j`;
}
