/**
 * listeOptions.js - Majord'home
 * ============================================================================
 * Règles de la liste déroulante avec recherche (Combobox, refonte UI phase 5).
 * Module PUR (aucun import React / Supabase / alias), testé par
 * scripts/liste-options.test.mjs. Une valeur se compare en chaîne, comme celle
 * d'un `<select>` natif : le Combobox rend à `onChange` ce que rendait
 * `e.target.value`.
 * ============================================================================
 */

import { normaliser } from './catalogue/recherchePieces.js';

/** Nombre d'options à partir duquel la liste propose un champ de recherche (DA § 7). */
export const SEUIL_RECHERCHE = 7;

/**
 * Les options à valeur vide (« Choisir… », « Tous ») ne comptent pas : ce ne sont pas des choix
 * à chercher, et la liste ne doit pas changer d'allure selon qu'une valeur est déjà choisie.
 * @param {Array<{ value: unknown, label: string }>|null|undefined} options
 * @returns {boolean}
 */
export const avecRecherche = (options) =>
  (options || []).filter((o) => String(o?.value ?? '') !== '').length >= SEUIL_RECHERCHE;

/**
 * Options dont le libellé contient la saisie, sans accent ni casse. Saisie vide : toutes.
 * @param {Array<{ value: unknown, label: string }>|null|undefined} options
 * @param {string} saisie
 * @returns {Array<{ value: unknown, label: string }>}
 */
export function filtrerOptions(options, saisie) {
  if (!Array.isArray(options)) return [];
  const cherche = normaliser(saisie).trim();
  if (!cherche) return options;
  return options.filter((o) => normaliser(String(o.label ?? '')).includes(cherche));
}

/**
 * Libellé de l'option choisie. `null` / `undefined` se lisent comme `''` (un `<select value={x || ''}>`).
 * @param {Array<{ value: unknown, label: string }>|null|undefined} options
 * @param {unknown} value
 * @returns {string|null}  null si aucune option ne porte cette valeur
 */
export function libelleDe(options, value) {
  const cle = value === null || value === undefined ? '' : String(value);
  const option = (options || []).find((o) => String(o.value ?? '') === cle);
  return option ? option.label : null;
}
