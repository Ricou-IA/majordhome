// ============================================================================
// Population des communes par code postal (geo.api.gouv.fr) — module PUR,
// injectable (fetch en paramètre), SANS cache : la version navigateur
// (src/lib/communePopulation.js) garde son cache localStorage ; celle-ci sert
// aux edges (auto-rdv-cron) qui nomment les grands secteurs par la ville la plus
// peuplée. Dégradation gracieuse : un CP en échec est ignoré, jamais de throw.
// ============================================================================

import { normalizeCity } from '../sectorClustering.js';

const API = 'https://geo.api.gouv.fr/communes';

/**
 * @param {string[]} codesPostaux
 * @param {{ fetchImpl?: Function, concurrence?: number, logger?: { warn?: Function } }} [opts]
 * @returns {Promise<Map<string, number>>}  clé = `normalizeCity(nom)`, valeur = population max vue
 */
export async function chargerPopulations(codesPostaux, { fetchImpl = globalThis.fetch, concurrence = 8, logger = null } = {}) {
  const cps = [...new Set((codesPostaux || []).map((c) => String(c || '').trim()).filter((c) => /^\d{5}$/.test(c)))];
  const pops = new Map();
  const unCp = async (cp) => {
    try {
      const res = await fetchImpl(`${API}?codePostal=${cp}&fields=nom,population&format=json`);
      if (!res || !res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      logger?.warn?.(`[populations] ${cp} : ${e?.message || e}`);
      return [];
    }
  };
  for (let i = 0; i < cps.length; i += concurrence) {
    const lot = cps.slice(i, i + concurrence);
    const listes = await Promise.all(lot.map(unCp));
    for (const communes of listes) {
      for (const c of communes) {
        const cle = normalizeCity(c?.nom || '');
        if (!cle) continue;
        const pop = Number(c?.population) || 0;
        if (!pops.has(cle) || pop > pops.get(cle)) pops.set(cle, pop);
      }
    }
  }
  return pops;
}
