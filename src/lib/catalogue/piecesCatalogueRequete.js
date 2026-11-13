// src/lib/catalogue/piecesCatalogueRequete.js
// Filtre serveur de la lecture des pièces de catalogue pour un appareil : un seul mot de la marque, normalisé, appliqué à la
// colonne `marque_recherche` de la vue (= lower(unaccent(marque + rayons)), pas le texte entier : « red » attraperait « vendredi »). Module pur, frontend seulement. Le classement fin
// reste celui de recherchePieces.js : ce mot ne fait que borner ce qu'on lit (un sur-ensemble des pièces de la marque),
// jamais décider d'une compatibilité. Une seule normalisation (celle de recherchePieces.js, alignée sur `unaccent`).

import { escapePostgrestSearchTerm } from '../postgrestUtils.js';
import { MOTS_GENERIQUES, MOTS_VIDES, normaliser } from './recherchePieces.js';

/** Découpe sur tout ce qui n'est ni lettre ni chiffre. */
const SEPARATEUR = /[^\p{L}\p{N}]+/u;

/**
 * Premier mot « utile » de la marque, tel que saisi (casse et accents gardés) : 2 caractères et plus, hors articles.
 * @param {unknown} marque
 * @returns {string} '' si rien d'exploitable
 */
function premierMotBrut(marque) {
  if (typeof marque !== 'string') return '';
  return marque.split(SEPARATEUR).find((m) => m.length >= 2 && !MOTS_VIDES.has(normaliser(m))) || '';
}

/**

 * Premier mot « utile » de la marque (hors articles, 2 caractères et plus), normalisé comme `marque_recherche` (minuscules,
 * sans accents : « Jotul » et « Jøtul » donnent `jotul`) puis échappé : à appliquer en `ilike '%mot%'` sur `marque_recherche`.
 * Le classement normalise marque et rayons de la même façon : le filtre est un sur-ensemble de ce qu'il retient.
 * @param {unknown} marque
 * @returns {string} '' si rien d'exploitable (le bloc n'interroge alors rien)
 */
export function motFiltreMarque(marque) {
  const brut = premierMotBrut(marque);
  return brut ? escapePostgrestSearchTerm(normaliser(brut)) : '';
}

/** Mots d'un texte : normalisés, lettres et chiffres seulement. */
function motsNormalises(v) {
  return typeof v === 'string' ? normaliser(v).split(SEPARATEUR).filter(Boolean) : [];
}

/**
 * Mot du modèle qui sert à la seconde lecture ciblée (marque très fournie) : le plus long des mots de 4 lettres et
 * plus, hors mots génériques et hors mots de la marque ; à égalité de longueur, le premier. Normalisé comme
 * `motFiltreMarque` et passé par `escapePostgrestSearchTerm`.
 * @param {unknown} modele
 * @param {unknown} [marque]
 * @returns {string} '' si le modèle ne prouve rien (pas de seconde lecture)
 */
export function motFiltreModele(modele, marque = '') {
  const deLaMarque = new Set(motsNormalises(marque));
  let meilleur = '';
  for (const m of motsNormalises(modele)) {
    if (deLaMarque.has(m) || MOTS_GENERIQUES.includes(m)) continue;
    if ((m.match(/\p{L}/gu) || []).length < 4) continue;
    if (m.length > meilleur.length) meilleur = m;
  }
  return meilleur ? escapePostgrestSearchTerm(meilleur) : '';
}

/**
 * Fusionne la lecture par marque et la lecture ciblée (marque + mot du modèle), sans doublon (par `id`).
 * - `tronque` : la première lecture a atteint la limite (le catalogue de la marque est plus grand que ce qu'on a lu) ;
 * - la seconde lecture n'est prise en compte que si la première est tronquée ; `null` = pas faite ou en échec ;
 * - `ciblee` : la seconde lecture a abouti SANS être elle-même tronquée (les pièces qui citent le modèle sont toutes là).
 * Ne modifie pas ses entrées.
 * @param {object[]|null|undefined} premiere
 * @param {object[]|null|undefined} seconde
 * @param {number} limite
 * @returns {{ lignes: object[], tronque: boolean, ciblee: boolean }}
 */
export function fusionnerLectures(premiere, seconde, limite) {
  const a = Array.isArray(premiere) ? premiere : [];
  const tronque = a.length >= limite;
  if (!tronque || !Array.isArray(seconde)) return { lignes: [...a], tronque, ciblee: false };
  const vus = new Set(a.map((l) => l?.id));
  const lignes = [...a, ...seconde.filter((l) => !vus.has(l?.id))];
  return { lignes, tronque, ciblee: seconde.length < limite };
}
