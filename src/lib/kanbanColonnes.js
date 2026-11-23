/**
 * kanbanColonnes.js - Majord'home
 * ============================================================================
 * Colonnes de Kanban repliables (Gagné et Perdu du pipeline des leads). Module
 * PUR (aucun import React / Supabase / alias), testé par
 * scripts/kanban-colonnes.test.mjs — KanbanBoard ne fait qu'afficher.
 *
 * Une colonne repliée reste une zone de dépôt : replier ne change que ce qui est
 * dessiné, jamais ce que produit le dépôt d'une carte.
 *
 * Préférences = `{ [cléDeColonne]: boolean }` (vrai = repliée), rangées par
 * utilisateur. Une colonne absente des préférences prend son état par défaut :
 * repliée si elle figure dans `repliablesParDefaut`, dépliée sinon.
 * ============================================================================
 */

/**
 * La colonne est-elle repliée ?
 * @param {string} cle - clé de la colonne (ex. 'gagne')
 * @param {Record<string, boolean>} preferences - choix de l'utilisateur
 * @param {string[]} repliablesParDefaut - colonnes repliables, repliées par défaut
 * @returns {boolean}
 */
export function colonneRepliee(cle, preferences, repliablesParDefaut) {
  const repliables = Array.isArray(repliablesParDefaut) ? repliablesParDefaut : [];
  if (!repliables.includes(cle)) return false;
  const choix = preferences?.[cle];
  return typeof choix === 'boolean' ? choix : true;
}

/**
 * Préférences après un clic sur « Replier » / « Déplier ». Une colonne qui n'est
 * pas repliable ne change pas.
 * @param {string} cle
 * @param {Record<string, boolean>} preferences
 * @param {string[]} repliablesParDefaut
 * @returns {Record<string, boolean>}
 */
export function basculerColonne(cle, preferences, repliablesParDefaut) {
  const actuelles = preferences && typeof preferences === 'object' ? preferences : {};
  const repliables = Array.isArray(repliablesParDefaut) ? repliablesParDefaut : [];
  if (!repliables.includes(cle)) return actuelles;
  return { ...actuelles, [cle]: !colonneRepliee(cle, actuelles, repliables) };
}

/**
 * Lit les préférences enregistrées. Texte absent ou abîmé ⇒ aucune préférence
 * (chaque colonne reprend son état par défaut) ; seules les valeurs booléennes
 * sont gardées.
 * @param {string|null|undefined} texte
 * @returns {Record<string, boolean>}
 */
export function lirePreferencesColonnes(texte) {
  if (!texte) return {};
  try {
    const lu = JSON.parse(texte);
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {};
    return Object.fromEntries(Object.entries(lu).filter(([, v]) => typeof v === 'boolean'));
  } catch {
    return {};
  }
}

/**
 * Clé de stockage des colonnes repliées, propre à chaque utilisateur.
 * @param {string} userId
 * @returns {string}
 */
export function cleColonnesRepliees(userId) {
  return `mdh-kanban-replie:${userId}`;
}
