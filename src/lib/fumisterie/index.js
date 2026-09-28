// src/lib/fumisterie/index.js
// Point d'entrée UNIQUE du moteur de métré (écran, edge Hermes, PDF) — module PUR.
// ENGINE_VERSION à incrémenter à tout changement de règle : fum_metres.engine_version le porte
// et l'écran affiche une bannière si le résultat enregistré vient d'une autre version.
import { geometrieG1, hauteurSortieMinimale } from './gabarits/g1.js';
import { controlesG1 } from './controles.js';
import { construireNomenclature, totaliser } from './nomenclature.js';

export const ENGINE_VERSION = 'g1-2026.09';

const GABARITS = {
  G1: { geometrie: geometrieG1, controles: controlesG1, sortieMinimale: hauteurSortieMinimale },
};

/**
 * @param {{ configuration: {code:string, gabarit_code:string}, gabarit: object, composants: object[], mapping: object[],
 *   articles: object[], reglages: object, releve: object }} p
 */
export function calculerMetre({ configuration, gabarit, composants, mapping, articles, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const moteur = GABARITS[code];
  if (!moteur) throw new Error(`Gabarit ${code} non pris en charge par le moteur (${ENGINE_VERSION})`);
  const geometrie = moteur.geometrie(releve, reglages);
  const alertes = moteur.controles(geometrie, releve, reglages);
  const nomenclature = construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages });
  const lignes = nomenclature.lignes;
  return { engine_version: ENGINE_VERSION, geometrie, lignes, alertes: [...alertes, ...nomenclature.alertes], totaux: totaliser(lignes) };
}

/** Hauteur de sortie minimale conforme pour le gabarit de la configuration (bouton « Ajuster »). */
export function sortieMinimale({ configuration, gabarit, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  return GABARITS[code].sortieMinimale(releve, reglages);
}

export { geometrieG1, controlesG1, construireNomenclature, totaliser };
