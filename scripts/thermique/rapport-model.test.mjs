// scripts/thermique/rapport-model.test.mjs
// buildRapportModel = mise en forme du rapport PDF. Le contrat testé ici : le PDF ne fabrique
// AUCUN chiffre — chaque valeur du modèle de rapport retombe sur celle de buildEtudeModel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEtudeModel, pacId } from '../../src/apps/thermique/lib/etudeModel.js';
import { buildThermiqueConfig } from '../../src/apps/thermique/lib/thermiqueConfig.js';
import {
  buildRapportModel, postesRapport, piecesRapport, courbeBivalence, hypothesesRapport,
  couleurRatio, POSTES_LABELS,
} from '../../src/apps/thermique/lib/rapportModel.js';
import {
  DONNEES_MAISON, dessinMaison, contexteMaison, compositionsMaison,
} from './lib/fixtureMaison.mjs';

const CATALOGUE = JSON.parse(readFileSync(new URL('../../src/apps/thermique/data/pac-catalogue.json', import.meta.url), 'utf8'));
const CONFIG = buildThermiqueConfig(undefined);
const DJU_GAILLAC = 1943;

/** etude wizard (maison de référence, mode dessin legacy) + volet PAC optionnel. */
function etude(pac = null, overrides = {}) {
  return {
    contexte: contexteMaison({ dju: DJU_GAILLAC, relance: true }),
    dessin: dessinMaison(),
    foisonnement: 1.2,
    compositions: compositionsMaison(),
    pac,
    ...overrides,
  };
}
const env = (pacCatalogue) => ({ config: CONFIG, data: { ...DONNEES_MAISON, pacCatalogue } });
const rapportEnv = (machine = null) => ({
  config: CONFIG, data: DONNEES_MAISON, machine, dateLabel: '5 août 2026', clientName: 'Client Test',
});

const proche = (reel, attendu, label) =>
  assert.ok(Math.abs(reel - attendu) < 1e-6, `${label}: obtenu ${reel}, attendu ${attendu}`);

test('postesRapport : somme des postes = total du bilan, part normalisée à 1', () => {
  const model = buildEtudeModel(etude(), env(null));
  const postes = postesRapport(model.bilan);
  assert.ok(postes.length > 0);
  // Invariant moteur : total === Σ parPoste (relance incluse) — le rapport ne doit rien perdre.
  proche(postes.reduce((s, p) => s + p.valeur, 0), model.bilan.total, 'Σ postes');
  proche(postes.reduce((s, p) => s + p.part, 0), 1, 'Σ parts');
  // Ordre canonique préservé (murs avant ventilation…)
  const attendu = POSTES_LABELS.map(([c]) => c).filter((c) => postes.some((p) => p.cle === c));
  assert.deepEqual(postes.map((p) => p.cle), attendu);
  assert.ok(postes.every((p) => p.largeur > 0 && p.largeur <= 1), 'largeurs dans ]0,1]');
});

test('postesRapport : bilan absent ou vide → liste vide (jamais throw)', () => {
  assert.deepEqual(postesRapport(null), []);
  assert.deepEqual(postesRapport({ parPoste: {} }), []);
});

test('piecesRapport : lignes = pièces chauffées, totaux cohérents, foisonnement propagé', () => {
  const model = buildEtudeModel(etude(), env(null));
  const p = piecesRapport(model.bilan);
  assert.equal(p.lignes.length, model.bilan.pieces.length);
  proche(p.totaux.total, model.bilan.total, 'total');
  proche(p.totaux.surface, model.bilan.pieces.reduce((s, x) => s + x.surface, 0), 'surface');
  // foisonnement 1.2 posé par buildEtudeModel sur puissanceEmetteur
  proche(p.totaux.emetteur, model.bilan.total * 1.2, 'Σ puissance émetteur');
  assert.equal(p.avecRelance, true); // contexte.relance = true
  assert.ok(p.ratioMax >= p.ratioMin);
  assert.ok(p.lignes.every((l) => /^#[0-9a-f]{6}$/.test(l.couleur)), 'couleurs hexadécimales');
});

test('piecesRapport : sans relance, la colonne relance est masquée', () => {
  const model = buildEtudeModel(etude(null, { contexte: contexteMaison({ dju: DJU_GAILLAC }) }), env(null));
  assert.equal(piecesRapport(model.bilan).avecRelance, false);
});

test('piecesRapport : bilan figé sans puissanceEmetteur → emetteur retombe sur total', () => {
  const bilan = { total: 1000, parPoste: {}, pieces: [{ id: 'a', nom: 'A', surface: 10, transmission: 800, ventilation: 200, total: 1000 }] };
  assert.equal(piecesRapport(bilan).lignes[0].emetteur, 1000);
});

test('couleurRatio : bornes bleu/ambre, clamp hors [0,1], valeur non finie → milieu', () => {
  assert.equal(couleurRatio(0), '#3b82f6');
  assert.equal(couleurRatio(1), '#f59e0b');
  assert.equal(couleurRatio(-5), '#3b82f6');
  assert.equal(couleurRatio(5), '#f59e0b');
  assert.equal(couleurRatio(NaN), couleurRatio(0.5));
});

test('courbeBivalence : PAC catalogue — échantillonnage [θe−2 ; θnc], besoin décroissant, croisement à la bivalence', () => {
  const machine = CATALOGUE.pacs.find((p) => !p.generique && p.copRef != null);
  const etu = etude({ mode: 'catalogue', pacId: pacId(machine), regime: 45 });
  const model = buildEtudeModel(etu, env(CATALOGUE));
  const courbe = courbeBivalence({
    bilan: model.bilan, thetaE: model.thetaE, thetaNC: CONFIG.theta_non_chauffage,
    pac: etu.pac, machine,
  });
  assert.ok(courbe.length > 5);
  assert.equal(courbe[0].theta, Math.round(model.thetaE) - 2);
  assert.equal(courbe[courbe.length - 1].theta, CONFIG.theta_non_chauffage);
  for (let i = 1; i < courbe.length; i += 1) {
    assert.ok(courbe[i].besoin <= courbe[i - 1].besoin + 1e-9, 'besoin décroissant avec θext');
  }
  // Le signe de (pac − besoin) doit s'inverser de part et d'autre du point de bivalence.
  const theta = model.pac.bivalence.thetaBivalence;
  const avant = courbe.filter((c) => c.theta < theta - 1);
  const apres = courbe.filter((c) => c.theta > theta + 1);
  if (avant.length) assert.ok(avant.every((c) => c.pac <= c.besoin + 1e-6), 'PAC insuffisante sous la bivalence');
  if (apres.length) assert.ok(apres.every((c) => c.pac >= c.besoin - 1e-6), 'PAC suffisante au-dessus');
});

test('courbeBivalence : PAC manuelle valide → courbe ; machine absente / points insuffisants → null', () => {
  const points = [{ tExt: -7, pTh: 5000 }, { tExt: 7, pTh: 9000 }];
  const model = buildEtudeModel(etude({ mode: 'manuelle', regime: 35, points, scopManuel: 3.2 }), env(null));
  const base = { bilan: model.bilan, thetaE: model.thetaE, thetaNC: CONFIG.theta_non_chauffage };
  assert.ok(courbeBivalence({ ...base, pac: { mode: 'manuelle', regime: 35, points }, machine: null }).length > 0);
  // Catalogue non chargé (machine null) : le PDF se rabat sur les seuls indicateurs, pas de throw.
  assert.equal(courbeBivalence({ ...base, pac: { mode: 'catalogue', regime: 45 }, machine: null }), null);
  assert.equal(courbeBivalence({ ...base, pac: { mode: 'manuelle', regime: 35, points: [points[0]] }, machine: null }), null);
  assert.equal(courbeBivalence({ ...base, bilan: null, pac: null, machine: null }), null);
});

test('hypothesesRapport : θe/DJU/ventilation/forfaits repris de l’état, U famille résolus', () => {
  const etu = etude();
  const model = buildEtudeModel(etu, env(null));
  const h = hypothesesRapport(etu, { config: CONFIG, data: DONNEES_MAISON, thetaE: model.thetaE });
  assert.equal(h.periode, 'avant 1974');           // annee 1960
  assert.equal(h.thetaE.valeur, model.thetaE);
  assert.equal(h.thetaE.force, false);
  assert.equal(h.dju.valeur, DJU_GAILLAC);
  assert.equal(h.ventilation.label, DONNEES_MAISON.ventilation.systemes.find((s) => s.id === 'vmc-sf-auto').nom);
  assert.equal(h.deltaUtb, CONFIG.delta_utb.iti); // isolation ITI
  assert.deepEqual(h.fRH, { actif: true, valeur: CONFIG.f_rh });
  assert.equal(h.foisonnement, 1.2);
  assert.equal(h.plancherBas, 'Terre-plein');      // legacy : lu depuis `dessin`
  assert.equal(h.toiture, 'Combles perdus');
  const murs = h.u.find((u) => u.famille === 'murs');
  assert.ok(Number.isFinite(murs.valeur) && murs.valeur > 0);
  assert.match(murs.source, /défaut/);
  assert.equal(h.u.find((u) => u.famille === 'fenetre').valeur, 1.3);
  assert.equal(h.nbExceptions, 0);
});

test('hypothesesRapport : θe forcé et DJU départemental sont signalés', () => {
  const etu = etude(null, { contexte: contexteMaison({ dju: 1800, djuFallback: true, thetaEForce: -9 }) });
  const h = hypothesesRapport(etu, { config: CONFIG, data: DONNEES_MAISON, thetaE: -9 });
  assert.deepEqual(h.thetaE, { valeur: -9, force: true });
  assert.deepEqual(h.dju, { valeur: 1800, fallback: true });
});

test('hypothesesRapport : les exceptions U par pièce sont comptées, pas appliquées au tableau famille', () => {
  const compositions = compositionsMaison();
  compositions.exceptions.parois['sejour:murs'] = { u: 0.25 };
  const etu = etude(null, { compositions });
  const h = hypothesesRapport(etu, { config: CONFIG, data: DONNEES_MAISON, thetaE: -5 });
  assert.equal(h.nbExceptions, 1);
  assert.notEqual(h.u.find((u) => u.famille === 'murs').valeur, 0.25);
});

test('buildRapportModel : chiffres identiques au modèle d’étude (aucun recalcul dans le PDF)', () => {
  const machine = CATALOGUE.pacs.find((p) => !p.generique && p.copRef != null);
  const etu = etude({ mode: 'catalogue', pacId: pacId(machine), regime: 45, prixKwh: 0.21 });
  const model = buildEtudeModel(etu, env(CATALOGUE));
  const r = buildRapportModel(etu, model, rapportEnv(machine));

  assert.equal(r.synthese.totalW, model.bilan.total);
  assert.equal(r.synthese.ratioWm2, model.bilan.ratioWm2);
  assert.equal(r.synthese.thetaE, model.thetaE);
  assert.deepEqual(r.synthese.fourchette, model.bilan.fourchette);
  assert.equal(r.pac.bivalence, model.pac.bivalence);
  assert.equal(r.pac.conso, model.pac.conso);
  assert.equal(r.pac.regime, 45);
  assert.equal(r.pac.prixKwh, 0.21);
  assert.equal(r.pac.machineLabel, `${machine.fabricant} — ${machine.modele}`);
  assert.ok(r.pac.courbe.length > 0);
  assert.equal(r.projet.dateLabel, '5 août 2026');
  assert.equal(r.projet.clientName, 'Client Test');
  assert.equal(r.projet.periode, 'avant 1974');
});

test('buildRapportModel : résultats FIGÉS (étude rouverte) — le rapport reprend le bilan persisté', () => {
  const etu = etude();
  const figes = {
    bilan: { total: 12345, ratioWm2: 99, gv: 300, fourchette: { min: 11728, max: 13580 }, alerteVraisemblance: false,
      parPoste: { murs: 8000, ventilation: 4345 },
      pieces: [{ id: 'a', nom: 'Séjour', surface: 20, transmission: 8000, ventilation: 4345, relance: 0, total: 12345, puissanceEmetteur: 14814 }] },
    thetaE: -5,
    pac: null,
    engineVersion: '0.9.0',
  };
  const r = buildRapportModel(etu, figes, rapportEnv());
  assert.equal(r.synthese.totalW, 12345);
  assert.equal(r.projet.engineVersion, '0.9.0');
  assert.equal(r.pieces.totaux.emetteur, 14814);
  assert.equal(r.pac, null);
});

test('buildRapportModel : sans PAC → section PAC absente, le reste du rapport reste complet', () => {
  const etu = etude();
  const model = buildEtudeModel(etu, env(null));
  const r = buildRapportModel(etu, model, rapportEnv());
  assert.equal(r.pac, null);
  assert.ok(r.synthese.postes.length > 0);
  assert.ok(r.pieces.lignes.length > 0);
  assert.ok(r.hypotheses.u.length === 6);
});

test('buildRapportModel : PAC catalogue non chargé (machine null) → indicateurs conservés, courbe null', () => {
  const points = [{ tExt: -7, pTh: 5000 }, { tExt: 7, pTh: 9000 }];
  const etu = etude({ mode: 'manuelle', regime: 35, points, scopManuel: 3.2 });
  const model = buildEtudeModel(etu, env(null));
  const r = buildRapportModel(etu, model, rapportEnv(null));
  assert.equal(r.pac.machineLabel, 'Points constructeur saisis');
  assert.ok(r.pac.courbe.length > 0); // mode manuel : la courbe ne dépend pas du catalogue
  assert.ok(r.pac.bivalence);
});
