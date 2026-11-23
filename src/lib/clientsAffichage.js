/**
 * clientsAffichage.js - Majord'home
 * ============================================================================
 * Règles d'affichage de la liste et de la fiche des clients (refonte UI, phase 3).
 * Module PUR (aucun import React / Supabase / alias), testé par
 * scripts/clients-affichage.test.mjs. Rien ici ne modifie une donnée : la casse
 * d'un nom n'est changée qu'à l'écran.
 * ============================================================================
 */

/** Mots écrits en minuscules au milieu d'un nom (« Maison de la Pierre »). */
const PARTICULES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'sur']);

/** Sigles gardés en capitales (formes juridiques, organismes). */
const SIGLES = new Set([
  'SCI', 'SARL', 'SAS', 'SASU', 'SA', 'EURL', 'SNC', 'EI', 'EIRL', 'GAEC', 'EARL', 'SCEA',
  'CCAS', 'SDIS', 'EHPAD', 'HLM', 'ASL', 'SEM', 'SPL', 'OPH', 'CHU', 'CH',
]);

const majusculeInitiale = (mot) => (mot ? mot.charAt(0).toLocaleUpperCase('fr-FR') + mot.slice(1) : mot);

/** Un mot sans tiret ni apostrophe : « dupont » → « Dupont ». */
const casseMot = (mot) => majusculeInitiale(mot.toLocaleLowerCase('fr-FR'));

/**
 * Casse « titre » d'un nom pour l'affichage : « FAMILLE DELORME » → « Famille Delorme ».
 * Tirets et apostrophes gardent une majuscule derrière (« Jean-Pierre », « D'Artagnan ») ;
 * les particules sont en minuscules sauf en tête ; les sigles connus restent en capitales.
 * @param {string|null|undefined} texte
 * @returns {string}  chaîne vide pour une valeur absente
 */
export function casseTitre(texte) {
  const mots = String(texte ?? '').trim().split(/\s+/).filter(Boolean);
  return mots
    .map((mot, rang) => {
      if (SIGLES.has(mot.toLocaleUpperCase('fr-FR'))) return mot.toLocaleUpperCase('fr-FR');
      const bas = mot.toLocaleLowerCase('fr-FR');
      if (rang > 0 && PARTICULES.has(bas)) return bas;
      // « d'estang » → « d'Estang » au milieu, « D'Artagnan » en tête ; « l'estang » idem.
      const apostrophe = bas.match(/^([dl])['’](.+)$/);
      if (apostrophe) {
        const [, lettre, reste] = apostrophe;
        const tete = rang === 0 ? lettre.toLocaleUpperCase('fr-FR') : lettre;
        return `${tete}'${reste.split('-').map(casseMot).join('-')}`;
      }
      return bas.split('-').map(casseMot).join('-');
    })
    .join(' ');
}

/** Colonnes que la liste des clients sait trier : celles de la vue `majordhome_clients`. */
export const COLONNES_TRIABLES = Object.freeze(['display_name', 'city', 'client_number', 'created_at']);

/** Colonnes dont le premier tri va du plus récent au plus ancien. */
const DESCENDANT_D_ABORD = new Set(['created_at']);

/**
 * Tri après un clic sur l'en-tête d'une colonne.
 * @param {{ cle: string, ascendant: boolean }} triActuel
 * @param {string} cle  colonne cliquée
 * @returns {{ cle: string, ascendant: boolean }|null}  null si la colonne ne se trie pas
 */
export function triSuivant(triActuel, cle) {
  if (!COLONNES_TRIABLES.includes(cle)) return null;
  if (triActuel?.cle === cle) return { cle, ascendant: !triActuel.ascendant };
  return { cle, ascendant: !DESCENDANT_D_ABORD.has(cle) };
}

/** Valeur comparable d'un champ de formulaire : espaces retirés, vide et absent confondus. */
const normaliser = (v) => {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v.trim() : v;
};

/**
 * Champs d'un formulaire qui diffèrent de leur valeur d'origine.
 * @param {Record<string, unknown>} initial
 * @param {Record<string, unknown>} courant
 * @returns {string[]}  clés modifiées, dans l'ordre de `initial` puis des clés nouvelles
 */
export function champsModifies(initial = {}, courant = {}) {
  const cles = [...new Set([...Object.keys(initial || {}), ...Object.keys(courant || {})])];
  return cles.filter((cle) => normaliser(initial?.[cle]) !== normaliser(courant?.[cle]));
}

/** Nombre affichable : un entier connu, sinon null (jamais un 0 inventé). */
const nombreConnu = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Sous-titre de la liste des clients : « 3 612 clients · 490 contrats d'entretien actifs ».
 * Une partie dont le chiffre est inconnu (chargement, échec) est omise.
 * @param {{ total_clients?: number|null, active_contracts?: number|null }|null|undefined} stats
 * @returns {string}  chaîne vide si aucun chiffre n'est connu
 */
export function sousTitreClients(stats) {
  const total = nombreConnu(stats?.total_clients);
  const contrats = nombreConnu(stats?.active_contracts);
  const parties = [];
  if (total !== null) parties.push(`${total.toLocaleString('fr-FR')} client${total > 1 ? 's' : ''}`);
  if (contrats !== null) {
    parties.push(`${contrats.toLocaleString('fr-FR')} contrat${contrats > 1 ? 's' : ''} d'entretien actif${contrats > 1 ? 's' : ''}`);
  }
  return parties.join(' · ');
}
