// scripts/thermique/etude-model.test.mjs
// buildEtudeModel = source de calcul unique (assemblage + bilan + volet PAC). Testé sur la maison
// de référence (fixture partagée) contre les moteurs appelés directement — mêmes chiffres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEtudeModel, ENGINE_VERSION, pacId, resultsPersistables } from '../../src/apps/thermique/lib/etudeModel.js';
import { assembleBatiment } from '../../src/apps/thermique/lib/assembleBatiment.js';
import { calculeBatiment } from '../../src/apps/thermique/lib/thermalEngine.js';
import { buildThermiqueConfig } from '../../src/apps/thermique/lib/thermiqueConfig.js';
import {
  DONNEES_MAISON, dessinMaison, contexteMaison, compositionsMaison, reglagesMaison,
} from './lib/fixtureMaison.mjs';

const CATALOGUE = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/pac-catalogue.json', import.meta.url), 'utf8'));
const CONFIG = buildThermiqueConfig(undefined);
const DJU_GAILLAC = 1943;
const CLIMAT = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/climat.json', import.meta.url), 'utf8'));
const U_DEFAUTS = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/u-defauts.json', import.meta.url), 'utf8'));
const COEFF_B = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/coefficients-b.json', import.meta.url), 'utf8'));
const VENTIL = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/ventilation.json', import.meta.url), 'utf8'));

/** etude wizard : maison de référence + dju résolu, avec un volet PAC optionnel. */
function etude(pac = null) {
  return {
    contexte: contexteMaison({ dju: DJU_GAILLAC }),
    dessin: dessinMaison(),
    compositions: compositionsMaison(),
    pac,
  };
}
const env = (pacCatalogue) => ({ config: CONFIG, data: { ...DONNEES_MAISON, pacCatalogue } });

const proche = (reel, attendu, label) =>
  assert.ok(Math.abs(reel - attendu) < 1e-6, `${label}: obtenu ${reel}, attendu ${attendu}`);

test('buildEtudeModel : sans PAC — bilan identique à l’appel direct, pac null', () => {
  const model = buildEtudeModel(etude(null), env(null));
  assert.equal(model.ok, true);
  assert.deepEqual(model.erreurs, []);
  assert.equal(model.thetaE, -5);
  assert.equal(model.pac, null);
  assert.equal(model.engineVersion, ENGINE_VERSION);
  assert.ok(model.parois.length > 0);

  // Référence : assembleur + moteur appelés directement (mêmes réglages).
  const { batiment } = assembleBatiment(dessinMaison(), {
    data: DONNEES_MAISON, contexte: contexteMaison({ dju: DJU_GAILLAC }),
    compositions: compositionsMaison(), reglages: reglagesMaison(),
  });
  const ref = calculeBatiment(batiment);
  proche(model.bilan.total, ref.total, 'total');
  proche(model.bilan.gv, ref.gv, 'gv');
});

test('buildEtudeModel : PAC catalogue — bivalence dans [θe, θnc], R4 respectée (charge=total, conso=gv)', () => {
  const pac = CATALOGUE.pacs.find((p) => !p.generique && p.copRef != null);
  const model = buildEtudeModel(etude({ mode: 'catalogue', pacId: pacId(pac), regime: 45 }), env(CATALOGUE));
  assert.equal(model.ok, true);
  assert.ok(model.pac, 'volet PAC présent');
  assert.ok(model.pac.bivalence.thetaBivalence >= model.thetaE - 1e-9
    && model.pac.bivalence.thetaBivalence <= CONFIG.theta_non_chauffage + 1e-9, 'bivalence bornée');
  assert.equal(model.pac.bivalence.avertissementChargePartielle, true); // PAC hplib
  assert.equal(model.pac.consoErreur, null);
  // R4 : besoin conso = 24 × dju × GV(bilan) / 1000 × facteur — recalculé ici (GV, pas total).
  const besoinAttendu = (24 * DJU_GAILLAC * model.bilan.gv / 1000) * CONFIG.facteur_ajustement;
  proche(model.pac.conso.besoinKwh, besoinAttendu, 'besoinKwh depuis GV');
  assert.ok(model.pac.conso.coutEuros > 0);
});

test('buildEtudeModel : PAC manuelle avec SCOP — conso calculée, pas d’avertissement charge partielle', () => {
  const pac = { mode: 'manuelle', regime: 35, scopManuel: 3.2,
    points: [{ tExt: -7, pTh: 5000 }, { tExt: 7, pTh: 9000 }] };
  const model = buildEtudeModel(etude(pac), env(null));
  assert.equal(model.ok, true);
  assert.equal(model.pac.bivalence.avertissementChargePartielle, false); // points constructeur
  assert.equal(model.pac.consoErreur, null);
  proche(model.pac.conso.consoElecKwh, model.pac.conso.besoinKwh / 3.2, 'conso élec via SCOP manuel');
});

test('buildEtudeModel : PAC manuelle SANS SCOP — bivalence OK mais consoErreur renseignée', () => {
  const pac = { mode: 'manuelle', regime: 35,
    points: [{ tExt: -7, pTh: 5000 }, { tExt: 7, pTh: 9000 }] };
  const model = buildEtudeModel(etude(pac), env(null));
  assert.equal(model.ok, true);
  assert.ok(model.pac.bivalence);
  assert.equal(model.pac.conso, null);
  assert.match(model.pac.consoErreur, /manuelle sans COP/);
});

test('buildEtudeModel : PAC catalogue mais catalogue non chargé → pac null (recalcul après lazy import)', () => {
  const pac = CATALOGUE.pacs.find((p) => !p.generique);
  const model = buildEtudeModel(etude({ mode: 'catalogue', pacId: pacId(pac), regime: 45 }), env(null));
  assert.equal(model.ok, true);
  assert.equal(model.pac, null);
});

test('resultsPersistables : ne persiste que bilan + thetaE + pac (parois exclues)', () => {
  const model = buildEtudeModel(etude(null), env(null));
  const r = resultsPersistables(model);
  assert.deepEqual(Object.keys(r).sort(), ['bilan', 'pac', 'thetaE']);
  assert.equal(r.bilan, model.bilan);   // pas de copie : le résultat est sérialisé tel quel
  assert.equal(r.thetaE, model.thetaE);
  assert.equal(r.pac, null);
});

test('buildEtudeModel : dessin invalide (pièce chauffée sans θint) → ok false, bilan null', () => {
  const e = etude(null);
  e.dessin.pieces.find((p) => p.id === 'chambre').thetaInt = null;
  const model = buildEtudeModel(e, env(null));
  assert.equal(model.ok, false);
  assert.equal(model.bilan, null);
  assert.ok(model.erreurs.some((m) => /consigne manquante/.test(m)));
  assert.equal(model.engineVersion, ENGINE_VERSION);
});

const saisieParam = {
  modeSaisie: 'parametrique', plancherBasType: 'terre-plein', toitureType: 'comble',
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, hauteur: 250, emprise: { polygone: [{x:0,y:0},{x:500,y:0},{x:500,y:400},{x:0,y:400}] } }],
  pieces: [{ id: 'sej', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20, longueur: 500, largeur: 400, hauteur: 250, mlMurExterieur: 900, mlMurLocalNonChauffe: 0, bLocalNonChauffe: 0.6, surfaceOuverture: 3, typeMenuiserie: 'fenetre' }],
};
const etudeParam = {
  contexte: { dept: '81', altitude: 200, annee: 2010, dju: 2200, typeVentilation: 'vmc-sf-auto', isolation: 'iti', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false },
  saisie: saisieParam,
  compositions: { familles: { murs: { mode: 'valeur', u: 0.4 }, plancherBas: { mode: 'valeur', u: 0.3 }, plafondToiture: { mode: 'valeur', u: 0.2 }, fenetre: { u: 1.3 }, porteFenetre: { u: 1.4 }, porte: { u: 3.5 } }, exceptions: { parois: {}, ouvertures: {} } },
  pac: { regime: 45, mode: null, pacId: null, points: [], scopManuel: null, prixKwh: 0.1952 },
};

test('buildEtudeModel : mode paramétrique → ok + puissance émetteur (foisonnement 1.2)', () => {
  const config = buildThermiqueConfig({ thermique: { foisonnement_emetteur: 1.2 } });
  const model = buildEtudeModel(etudeParam, { config, data: { climat: CLIMAT, uDefauts: U_DEFAUTS, coefficientsB: COEFF_B, ventilation: VENTIL, pacCatalogue: null } });
  assert.equal(model.ok, true);
  const p = model.bilan.pieces[0];
  assert.ok(Math.abs(p.puissanceEmetteur - p.total * 1.2) < 1e-6);
});
