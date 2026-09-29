// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/secteurs.js — ne pas éditer.
// ============================================================================
// Grands secteurs côté serveur — module PUR. Même partition que l'onglet
// Programmation (entretiens.service.js::getContractsBySector) : contrats groupés
// par code postal client, regroupés par proximité (clusterSectorsByProximity,
// rayon 15 km), nommés par la ville la plus peuplée. Sert à l'edge auto-rdv-cron
// (contrats dus par secteur, étiquetage des journées vides).
//
// Noms NORMALISÉS (« ALBI » / « Albi » coexistaient en base, 2026-09-29) :
// `normaliserSecteur` met la première lettre de chaque mot en majuscule.
// ============================================================================

import { clusterSectorsByProximity } from './sectorClustering.js';

const NON_LOCALISE = 'Non localisé';

/**
 * « ALBI » → « Albi », « cordes sur ciel » → « Cordes Sur Ciel », espaces normalisés.
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normaliserSecteur(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
}

/**
 * Partition des contrats en grands secteurs et maps de résolution.
 *
 * @param {Array<{ id?: string, client_id: string, client_postal_code?: string|null, client_city?: string|null,
 *   client_latitude?: number|null, client_longitude?: number|null, current_year_visit_status?: string|null }>} contrats
 * @param {{ radiusKm?: number, cityPopulation?: Map<string, number>|null }} [opts]
 * @returns {{ secteurs: Array<{ id: string, name: string, codePostals: string[], centroid: object|null, visitsPending: number }>,
 *   byClient: Map<string, string>, byCp: Map<string, string> }}  noms normalisés ; « Non localisé » exclu des maps
 */
export function secteursDepuisContrats(contrats, { radiusKm = 15, cityPopulation = null } = {}) {
  const parCp = new Map();
  for (const c of contrats || []) {
    const cp = String(c.client_postal_code || '').trim() || 'Inconnu';
    if (!parCp.has(cp)) {
      parCp.set(cp, { codePostal: cp, commune: c.client_city || '', contracts: [], totalContracts: 0, visitsDone: 0, visitsPending: 0 });
    }
    const s = parCp.get(cp);
    s.contracts.push(c);
    s.totalContracts += 1;
    if (c.current_year_visit_status === 'completed') s.visitsDone += 1;
    else s.visitsPending += 1;
  }
  const secteursCp = [...parCp.values()].sort((a, b) => b.visitsPending - a.visitsPending || a.codePostal.localeCompare(b.codePostal));
  const groupes = clusterSectorsByProximity(secteursCp, { radiusKm, cityPopulation });
  const byCp = new Map();
  const byClient = new Map();
  const secteurs = [];
  for (const g of groupes) {
    if (g.name === NON_LOCALISE) continue;
    const nom = normaliserSecteur(g.name);
    secteurs.push({ ...g, name: nom });
    for (const cp of g.codePostals || []) {
      byCp.set(cp, nom);
      for (const c of parCp.get(cp)?.contracts || []) {
        if (c.client_id) byClient.set(c.client_id, nom);
      }
    }
  }
  return { secteurs, byClient, byCp };
}
