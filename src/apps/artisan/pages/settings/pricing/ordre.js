// src/apps/artisan/pages/settings/pricing/ordre.js
// ============================================================================
// Rang des éléments de la grille (zones, catégories, types, options). Module
// PUR : le champ « Ordre » n'est plus saisi (Eric, 2026-09-12 : « ça ne sert à
// rien ») ; `sort_order` reste le tri des listes et un nouvel élément se range
// EN FIN (ordre de création) — jamais en tête (0), ce qui ferait passer un
// type de test devant les poêles chez Mayer.
// ============================================================================

/** @param {Array<{ sort_order?: number|null }>} items  éléments existants (actifs ou non) */
export function prochainOrdre(items) {
  return (items || []).reduce((max, it) => Math.max(max, Number(it?.sort_order) || 0), 0) + 1;
}
