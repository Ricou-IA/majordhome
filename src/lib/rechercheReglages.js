/**
 * rechercheReglages.js — retrouver un réglage par son nom (page Paramètres, brief UX P2-01).
 * ============================================================================
 * Filtre les tuiles des groupes visibles (`modulesVisibles`) sur leur titre, leur description
 * et le nom de leur module, sans tenir compte des accents ni de la casse ; chaque mot saisi
 * doit apparaître. Un groupe sans tuile retenue disparaît. Module pur, testé :
 * scripts/recherche-reglages.test.mjs.
 * ============================================================================
 */

const forme = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * @param {Array<{ key: string, label: string, description?: string, tiles: Array<{ title: string, description?: string }> }>} groupes
 * @param {string} terme
 */
export function filtrerReglages(groupes = [], terme = '') {
  const mots = forme(terme).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return groupes;
  return groupes
    .map((g) => ({
      ...g,
      tiles: g.tiles.filter((t) => {
        const texte = forme(`${t.title} ${t.description || ''} ${g.label}`);
        return mots.every((m) => texte.includes(m));
      }),
    }))
    .filter((g) => g.tiles.length > 0);
}
