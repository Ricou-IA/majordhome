// scripts/thermique/lib/fixtureMaison.mjs
// Maison de référence partagée (plans 3-4), consommée par assemble-batiment / integration-dessin-bilan
// / etude-model. RDC (h 250 cm) : séjour 500×400 (θ20) + cuisine 300×400 (θ20, humide) accolée est +
// garage 300×400 (non chauffé) accolé est ; étage (h 250) : chambre 500×400 (θ18) posée sur le séjour.
// Fenêtre séjour 140×120 au sud, porte d'entrée 90×215 au nord. Nord = 0, terre-plein, comble.
import { readFileSync } from 'node:fs';

const lire = (f) => JSON.parse(readFileSync(new URL(`../../../src/apps/thermique/data/${f}`, import.meta.url), 'utf8'));

/** Données de référence (plan 1) chargées une fois pour les tests de l'assembleur. */
export const DONNEES_MAISON = {
  climat: lire('climat.json'),
  uDefauts: lire('u-defauts.json'),
  coefficientsB: lire('coefficients-b.json'),
  ventilation: lire('ventilation.json'),
};

export function dessinMaison({ thetaCuisine = 20 } = {}) {
  return {
    nord: 0,
    plancherBasType: 'terre-plein',
    toitureType: 'comble',
    niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }, { id: 'etage', nom: 'Étage', hauteur: 250 }],
    pieces: [
      { id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
      { id: 'cuisine', niveauId: 'rdc', nom: 'Cuisine', typePiece: 'cuisine', chauffee: true, thetaInt: thetaCuisine,
        polygone: [{ x: 500, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 500, y: 400 }] },
      { id: 'garage', niveauId: 'rdc', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null,
        polygone: [{ x: 800, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 400 }, { x: 800, y: 400 }] },
      { id: 'chambre', niveauId: 'etage', nom: 'Chambre', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] },
    ],
    ouvertures: [
      { id: 'fen-sejour', pieceId: 'sejour', segmentIndex: 1, type: 'fenetre', largeur: 140, hauteur: 120, position: 180 },
      { id: 'porte-entree', pieceId: 'sejour', segmentIndex: 3, type: 'porte', largeur: 90, hauteur: 215, position: 200 },
    ],
  };
}

/** Contexte wizard : Gaillac (81, 134 m) ; 1960 → « avant 1974 » ; ITI → ΔUtb 0.10 (= 0.1 réf). */
export function contexteMaison(overrides = {}) {
  return {
    dept: '81', altitude: 134, annee: 1960, typeVentilation: 'vmc-sf-auto',
    isolation: 'iti', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false,
    ...overrides,
  };
}

/** Compositions : U murs/planchers/plafonds par défaut de période ; Uw/Uporte saisis (D3). */
export function compositionsMaison({ uFenetre = 1.3, uPorte = 3.5 } = {}) {
  return {
    familles: {
      murs: { mode: 'defaut', u: null },
      plancherBas: { mode: 'defaut', u: null },
      plafondToiture: { mode: 'defaut', u: null },
      fenetre: { u: uFenetre }, porteFenetre: { u: uFenetre }, porte: { u: uPorte },
    },
    exceptions: { parois: {}, ouvertures: {} },
  };
}

/** Réglages org : table ΔUtb par isolation (défauts thermiqueConfig) + fRH. */
export function reglagesMaison({ deltaUtb, fRH = 0 } = {}) {
  return { deltaUtb: deltaUtb ?? { 'non-isole': 0.15, iti: 0.10, ite: 0.05 }, fRH };
}
