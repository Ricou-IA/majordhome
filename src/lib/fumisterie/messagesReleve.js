// src/lib/fumisterie/messagesReleve.js
// Texte des refus du relevé, écrits sous le champ fautif (module PUR). Entrées = champsAcorriger (index.js).
import { formaterSaisie } from './saisie.js';

const avecUnite = (v, unite) => `${formaterSaisie(v)}${unite ? ` ${unite}` : ''}`;

/**
 * @param {{ libelle: string, code: 'vide'|'hors_plage'|'choix', min?: number|null, max?: number|null, valeur?: unknown, unite?: string|null }} e
 * @returns {string}
 */
export function messageChamp(e) {
  if (e.code === 'vide') return `${e.libelle} : à renseigner.`;
  if (e.code === 'choix') return `${e.libelle} : choisissez une valeur.`;
  const plage = e.min != null && e.max != null ? `entre ${formaterSaisie(e.min)} et ${avecUnite(e.max, e.unite)}`
    : e.min != null ? `au moins ${avecUnite(e.min, e.unite)}` : `au plus ${avecUnite(e.max, e.unite)}`;
  return `${e.libelle} : ${plage}. Vous avez saisi ${avecUnite(e.valeur, e.unite)}.`;
}

/** « 1 champ à corriger » / « 2 champs à corriger ». @param {number} n @returns {string} */
export function titreChampsAcorriger(n) {
  return `${n} champ${n > 1 ? 's' : ''} à corriger`;
}
