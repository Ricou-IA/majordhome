/**
 * devisValidation.js — ce qu'il faut pour créer (ou enregistrer) un devis (module pur).
 * ============================================================================
 * « Créer le devis » n'est ouvert qu'avec un objet ET au moins une ligne qui porte une
 * désignation et un montant HT > 0. Une ligne vide ou à 0 € ne compte pas : elle partait
 * telle quelle (un devis sans contenu chez le client). La raison s'écrit à côté du bouton,
 * jamais dans une infobulle. Testé : scripts/devis-validation.test.mjs.
 * ============================================================================
 */
import { computeLineTotals } from './devisCalculs.js';

export const RAISONS_DEVIS = Object.freeze({
  objet: 'Indiquez l’objet du devis',
  ligne: 'Ajoutez une ligne avec une désignation et un montant',
});

/** Une ligne (hors titre de chapitre) peut-elle porter le devis à elle seule ? */
export function ligneChiffree(ligne) {
  if (!ligne || ligne.line_type === 'section_title') return false;
  if (String(ligne.designation ?? '').trim() === '') return false;
  return computeLineTotals(ligne).total_ht > 0;
}

/**
 * Ce qui manque pour créer le devis, dans l'ordre de l'écran (objet, puis lignes).
 * @param {{ subject?: string, lines?: object[] }} p
 * @returns {{ objet: boolean, ligne: boolean, raison: string|null }}
 */
export function manquesDevis({ subject = '', lines = [] } = {}) {
  const objet = String(subject ?? '').trim() === '';
  const ligne = !lines.some(ligneChiffree);
  const raison = objet ? RAISONS_DEVIS.objet : (ligne ? RAISONS_DEVIS.ligne : null);
  return { objet, ligne, raison };
}
