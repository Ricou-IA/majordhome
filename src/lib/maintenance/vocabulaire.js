// src/lib/maintenance/vocabulaire.js
// ============================================================================
// Vocabulaire affiché du module de tâches récurrentes — module PUR, testé par
// `node --test scripts/maintenance/vocabulaire.test.mjs`, copié pour Deno
// (e-mail du soir) par `npm run sync:tournee-engine`.
// Le module est générique : une usine parle de « Maintenance » et d'« unités »
// (machines), un dépôt de « Traçabilité » et de « zones ». Réglage par org :
// `settings.maintenance.vocabulaire = { module, unite, unites }`, éditable dans
// Settings → Tâches récurrentes → Vocabulaire. La clé technique reste `maintenance`.
// ============================================================================

export const VOCABULAIRE_DEFAUT = Object.freeze({ module: 'Maintenance', unite: 'Unité', unites: 'Unités' });

/** @param {unknown} v @returns {string} texte nettoyé, '' si absent ou non textuel */
const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * @param {object|null|undefined} settings core.organizations.settings
 * @returns {{ module: string, unite: string, unites: string }}
 */
export function vocabulaire(settings) {
  const v = settings?.maintenance?.vocabulaire || {};
  const module = texte(v.module) || VOCABULAIRE_DEFAUT.module;
  const uniteSaisie = texte(v.unite);
  const unite = uniteSaisie || VOCABULAIRE_DEFAUT.unite;
  let unites = texte(v.unites);
  if (!unites) unites = uniteSaisie ? (/[sxz]$/i.test(uniteSaisie) ? uniteSaisie : `${uniteSaisie}s`) : VOCABULAIRE_DEFAUT.unites;
  return { module, unite, unites };
}
