// src/lib/fumisterie/index.js
// Point d'entrée UNIQUE du moteur de métré (écran, edge Hermes, PDF) — module PUR.
// ENGINE_VERSION à incrémenter à tout changement de règle : fum_metres.engine_version le porte
// et l'écran affiche une bannière si le résultat enregistré vient d'une autre version.
import { geometrieG1, hauteurSortieMinimale } from './gabarits/g1.js';
import { geometrieG4 } from './gabarits/g4.js';
import { geometrieG3, hauteurSortieMinimaleG3 } from './gabarits/g3.js';
import { geometrieG6 } from './gabarits/g6.js';
import { controlesG1, controlesG3, controlesG4, controlesG5, controlesG6 } from './controles.js';
import { construireNomenclature, totaliser } from './nomenclature.js';

export const ENGINE_VERSION = 'g6-2026.09';

const GABARITS = {
  G1: { geometrie: geometrieG1, controles: controlesG1, sortieMinimale: hauteurSortieMinimale },
  // Tubage : même géométrie, le code du gabarit dit si le conduit est flexible (G4) ou rigide PRH (G4R).
  G4: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false }, cfg), controles: controlesG4, sortieMinimale: null },
  G4R: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: true }, cfg), controles: controlesG4, sortieMinimale: null },
  // Flexible isolé POLYPERF : le bas de conduit (`bas`) décide de l'entrée ; sur un foyer, pas de tuyau de raccordement.
  G4P: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, entree: r.bas === 'mur' ? 'mur' : 'plafond', hsp1: r.bas === 'foyer' ? r.hBuse : r.hsp1 }, cfg), controles: (g, r, cfg) => controlesG4(g, r, cfg).filter((a) => !(a.code === 'buse' && r.bas === 'foyer')), sortieMinimale: null },
  // Kit rénovation PLA (adaptateurs haut/bas) : même géométrie qu'un tubage flexible.
  G4K: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false }, cfg), controles: controlesG4, sortieMinimale: null },
  // Foyer raccordé directement au flexible (Griffaflex) : pas de tuyau simple paroi.
  G4F: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, entree: 'plafond', hsp1: r.hBuse }, cfg), controles: (g, r, cfg) => controlesG4(g, r, cfg).filter((a) => a.code !== 'buse'), sortieMinimale: null },
  // Raccordement seul : pas de conduit métré (dessiné à titre indicatif).
  G5: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, hConduit: 0 }, cfg), controles: controlesG5, sortieMinimale: null },
  G3: { geometrie: geometrieG3, controles: controlesG3, sortieMinimale: hauteurSortieMinimaleG3 },
  G3P: { geometrie: geometrieG3, controles: controlesG3, sortieMinimale: hauteurSortieMinimaleG3 },
  G6: { geometrie: geometrieG6, controles: controlesG6, sortieMinimale: null },
};

/**
 * Un paramètre conditionnel (`si`) n'est affiché — donc exigé — que si sa condition est remplie :
 * `{ nbEtages: 1 }` (égalité) ou `{ angle: '>0' }`.
 * @param {{ si?: Record<string, unknown> }} p paramètre du gabarit
 * @param {Record<string, unknown>} releve
 * @returns {boolean}
 */
export function parametreVisible(p, releve) {
  if (!p.si) return true;
  return Object.entries(p.si).every(([k, v]) => (v === '>0' ? Number(releve[k]) > 0 : releve[k] === v));
}

const fmt = (v) => String(v).replace('.', ',');

/**
 * Contrôle le relevé contre les paramètres du gabarit : chaque paramètre visible doit être un
 * nombre fini dans [min, max] (ou l'une des valeurs de `choix`). Un champ vidé ne doit JAMAIS
 * devenir un 0 silencieux dans la géométrie.
 * @param {{ troncons?: Array<{ parametres: Array<object> }> } | null | undefined} gabarit
 * @param {Record<string, unknown> | null | undefined} releve
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerReleve(gabarit, releve) {
  if (!gabarit?.troncons?.length) return { ok: false, erreurs: ['gabarit de métré absent'] };
  const r = releve || {};
  const erreurs = [];
  for (const t of gabarit.troncons) {
    for (const p of t.parametres || []) {
      if (!parametreVisible(p, r)) continue;
      const v = r[p.cle];
      if (p.choix) {
        if (!p.choix.includes(v)) erreurs.push(`${p.libelle} (valeur attendue parmi ${p.choix.map(fmt).join(', ')})`);
        continue;
      }
      if (v === '' || v == null || typeof v !== 'number' || !Number.isFinite(v)) { erreurs.push(`${p.libelle} (non renseigné)`); continue; }
      const u = p.unite ? ` ${p.unite}` : '';
      if ((p.min != null && v < p.min) || (p.max != null && v > p.max)) {
        erreurs.push(`${p.libelle} (${fmt(v)}${u} hors plage ${fmt(p.min ?? '−∞')}–${fmt(p.max ?? '+∞')}${u})`);
      }
    }
  }
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * @param {{ configuration: {code:string, gabarit_code:string}, gabarit: object, composants: object[], mapping: object[],
 *   articles: object[], reglages: object, releve: object }} p
 */
export function calculerMetre({ configuration, gabarit, composants, mapping, articles, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const moteur = GABARITS[code];
  if (!moteur) throw new Error(`Gabarit ${code} non pris en charge par le moteur (${ENGINE_VERSION})`);
  const validation = validerReleve(gabarit, releve);
  if (!validation.ok) throw new Error(`Relevé incomplet : ${validation.erreurs.join(' ; ')}`);
  const geometrie = moteur.geometrie(releve, reglages);
  const alertes = moteur.controles(geometrie, releve, reglages);
  const nomenclature = construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages });
  const lignes = nomenclature.lignes;
  return { engine_version: ENGINE_VERSION, geometrie, lignes, alertes: [...alertes, ...nomenclature.alertes], totaux: totaliser(lignes) };
}

/** Hauteur de sortie minimale conforme pour le gabarit de la configuration (bouton « Ajuster »). null si le gabarit n'a pas de sortie de toit (tubage). */
export function sortieMinimale({ configuration, gabarit, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const fn = GABARITS[code]?.sortieMinimale;
  return fn ? fn(releve, reglages) : null;
}

export { geometrieG1, geometrieG3, geometrieG4, geometrieG6, controlesG1, controlesG3, controlesG4, controlesG5, controlesG6, construireNomenclature, totaliser };
