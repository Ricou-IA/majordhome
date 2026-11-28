// Règles du NF DTU 24.1, du Cahier CSTB 3708 et de l'arrêté de 1969 en alertes NON bloquantes
// (spec 2026-11-28 § B) : pour chaque règle, un cas qui la déclenche et un qui ne la déclenche pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometrieG1 } from '../../src/lib/fumisterie/gabarits/g1.js';
import { geometrieG3 } from '../../src/lib/fumisterie/gabarits/g3.js';
import { geometrieG4 } from '../../src/lib/fumisterie/gabarits/g4.js';
import { geometrieG6 } from '../../src/lib/fumisterie/gabarits/g6.js';
import { controlesG1, controlesG3, controlesG4, controlesG5, controlesG6, controlesNomenclature, pointsAVerifier, natureInstallation, alerteDirections } from '../../src/lib/fumisterie/controles.js';
import { exigenceDebouche } from '../../src/lib/fumisterie/debouche.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const cfg = buildFumisterieConfig(null);
const G1 = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5, hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };
const G3 = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, hTraversee: 1.6, lHoriz: 0.6, epMur: 0.3, hMur: 5.5, pente: 35, dFaitage: 4, hSortie: 3.5 };
const G4 = { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, hEntree: 1.5, lHoriz: 0.5, hConduit: 6, boisseau: 1 };
const G6 = { diametre: 80, finition: 'noir', hBuse: 1.05, hSortie: 2.8, lHoriz: 0.6, epMur: 0.3 };
const TRAD = { appareil_etanche_requis: false, combustibles: ['bois_buches'] };
const ETANCHE_GRANULES = { appareil_etanche_requis: true, combustibles: ['pellets'] };
const ETANCHE_BOIS = { appareil_etanche_requis: true, combustibles: ['bois_buches'] };

const c1 = (r, conf = TRAD) => controlesG1(geometrieG1(r, cfg), r, cfg, conf);
const c3 = (r, conf = TRAD) => controlesG3(geometrieG3(r, cfg), r, cfg, conf);
const c4 = (r) => controlesG4(geometrieG4(r, cfg), r, cfg);
const c6 = (r) => controlesG6(geometrieG6(r, cfg), r);
const a = (alertes, code) => alertes.find((x) => x.code === code);

test('nature de l\'installation : CFG-24 traditionnelle, CFG-28 étanche granulés, CFG-40 étanche bois', () => {
  assert.equal(natureInstallation(TRAD), 'traditionnelle');
  assert.equal(natureInstallation(ETANCHE_GRANULES), 'etanche_granules');
  assert.equal(natureInstallation(ETANCHE_BOIS), 'etanche_bois');
  assert.equal(natureInstallation(null), 'traditionnelle');
});

test('hauteur de sortie : faîtage à moins de 8 m = règle d\'avant ; au-delà, le toit à 8 m', () => {
  const avant = exigenceDebouche({ yToit: 7.2, dFaitage: 1.6, pente: 35, releve: {}, cfg });
  assert.ok(Math.abs(avant.yReq - (7.2 + 1.6 * Math.tan(35 * Math.PI / 180) + 0.4)) < 1e-9);
  assert.equal(avant.critere, 'faitage');
  const loin = exigenceDebouche({ yToit: 7.2, dFaitage: 12, pente: 35, releve: {}, cfg });
  assert.equal(loin.critere, 'toit_8m');
  assert.ok(Math.abs(loin.yReq - (7.2 + 8 * Math.tan(35 * Math.PI / 180) + 0.4)) < 1e-9);
});

test('hauteur de sortie : un obstacle plus haut à moins de 8 m s\'impose, pas au-delà', () => {
  const pres = exigenceDebouche({ yToit: 7.2, dFaitage: 1.6, pente: 35, releve: { obstacleDistance: 5, obstacleHauteur: 3 }, cfg });
  assert.equal(pres.critere, 'obstacle'); assert.ok(Math.abs(pres.yReq - 10.6) < 1e-9);
  const loin = exigenceDebouche({ yToit: 7.2, dFaitage: 1.6, pente: 35, releve: { obstacleDistance: 9, obstacleHauteur: 3 }, cfg });
  assert.equal(loin.critere, 'faitage');
  const sansHauteur = exigenceDebouche({ yToit: 7.2, dFaitage: 1.6, pente: 35, releve: { obstacleDistance: 5, obstacleHauteur: '' }, cfg });
  assert.equal(sansHauteur.critere, 'faitage');
});

test('toit plat : pente < 15° (15° n\'est plus plat), 1,20 m, acrotère de plus de 0,20 m + 1 m', () => {
  assert.equal(geometrieG1({ ...G1, pente: 15 }, cfg).flat, false);
  assert.equal(geometrieG1({ ...G1, pente: 14 }, cfg).flat, true);
  const plat = exigenceDebouche({ yToit: 7, dFaitage: 0, pente: 5, releve: {}, cfg });
  assert.ok(Math.abs(plat.yReq - 8.2) < 1e-9);
  const acr = exigenceDebouche({ yToit: 7, dFaitage: 0, pente: 5, releve: { hAcrotere: 0.6 }, cfg });
  assert.equal(acr.critere, 'acrotere'); assert.ok(Math.abs(acr.yReq - 8.6) < 1e-9);
  const petit = exigenceDebouche({ yToit: 7, dFaitage: 0, pente: 5, releve: { hAcrotere: 0.15 }, cfg });
  assert.equal(petit.critere, 'toit_plat');
});

test('hauteur de sortie : warn en traditionnel, info en étanche (granulés ou bois)', () => {
  const bas = { ...G1, hSortie: 0.5 };
  assert.equal(a(c1(bas), 'zone1').niveau, 'warn');
  assert.match(a(c1(bas), 'zone1').source, /22\/10\/1969/);
  assert.equal(a(c1(G1), 'zone1').niveau, 'ok');
  assert.equal(a(c1(bas, ETANCHE_GRANULES), 'zone1').niveau, 'info');
  assert.match(a(c1(bas, ETANCHE_GRANULES), 'zone1').source, /3708/);
  assert.equal(a(c1(bas, ETANCHE_BOIS), 'zone1').niveau, 'info');
  assert.match(a(c1(bas, ETANCHE_BOIS), 'zone1').message, /Avis Technique/);
  assert.equal(a(c3({ ...G3, hSortie: 0.5 }), 'zone1').niveau, 'warn');
});

test('dévoiement : angle > 45° et hauteur entre coudes > 5 m (§ 5.4.1.2.2)', () => {
  assert.equal(a(c1({ ...G1, angle: 60 }), 'devoiement_angle').niveau, 'warn');
  assert.equal(a(c1({ ...G1, angle: 45 }), 'devoiement_angle'), undefined);
  const haut = { ...G1, angle: 15, decal: 1.5, hCombles: 6 }; // vg = 1,5 / tan 15° ≈ 5,6 m
  assert.equal(a(c1(haut), 'devoiement_hauteur').niveau, 'warn');
  assert.equal(a(c1(G1), 'devoiement_hauteur'), undefined);
});

test('raccordement : horizontal > 3 m (§ 13.1.7)', () => {
  assert.equal(a(c3({ ...G3, lHoriz: 3.5 }), 'raccordement_horizontal').niveau, 'warn');
  assert.equal(a(c3(G3), 'raccordement_horizontal'), undefined);
  assert.equal(a(c4({ ...G4, entree: 'mur', lHoriz: 3.2 }), 'raccordement_horizontal').niveau, 'warn');
  assert.equal(a(c4(G4), 'raccordement_horizontal'), undefined);
  const g5 = controlesG5(geometrieG4({ ...G4, entree: 'mur', lHoriz: 4, hConduit: 0 }, cfg), { ...G4, entree: 'mur', lHoriz: 4 });
  assert.equal(a(g5, 'raccordement_horizontal').niveau, 'warn');
});

test('raccordement : changements de direction cumulés > 180° (té non compté)', () => {
  assert.equal(alerteDirections(270).niveau, 'warn');
  assert.equal(alerteDirections(180), null);
  assert.equal(a(c3(G3), 'raccordement_directions'), undefined);
});

test('section : conduit plus petit que la buse → warn ; plus grand → info (§ 13.1.3)', () => {
  assert.equal(a(c1({ ...G1, diametreBuse: 180 }), 'section_buse').niveau, 'warn');
  assert.equal(a(c1({ ...G1, diametreBuse: 130 }), 'section_buse').niveau, 'info');
  assert.equal(a(c1({ ...G1, diametreBuse: 150 }), 'section_buse'), undefined);
  assert.equal(a(c1(G1), 'section_buse'), undefined);
});

test('té obligatoire si la buse sort par l\'arrière (§ 5.4.4.2), lu dans la nomenclature', () => {
  const sansTe = [{ composant_code: 'tuyau_emaille' }, { composant_code: 'raccord_simple_paroi' }];
  const avecTe = [...sansTe, { composant_code: 'te_90_ptr' }];
  assert.equal(a(controlesNomenclature('G1', sansTe, { sortieBuse: 'arriere' }), 'te_buse_arriere').niveau, 'warn');
  assert.equal(a(controlesNomenclature('G1', avecTe, { sortieBuse: 'arriere' }), 'te_buse_arriere'), undefined);
  assert.equal(a(controlesNomenclature('G1', sansTe, { sortieBuse: 'dessus' }), 'te_buse_arriere'), undefined);
  assert.equal(a(controlesNomenclature('G1', sansTe, {}), 'te_buse_arriere'), undefined);
});

test('tubage : dévoiement du conduit existant > 45° (§ 15.1) ; plus d\'un raccord de flexible (§ 15.4.1.1)', () => {
  assert.equal(a(c4({ ...G4, angleBoisseau: 60 }), 'devoiement_tubage').niveau, 'warn');
  assert.equal(a(c4({ ...G4, angleBoisseau: 30 }), 'devoiement_tubage'), undefined);
  assert.equal(a(c4(G4), 'devoiement_tubage'), undefined);
  assert.equal(a(c4({ ...G4, hConduit: 62 }), 'flexible_raccords').niveau, 'warn');
  assert.equal(a(c4({ ...G4, hConduit: 40 }), 'flexible_raccords'), undefined);
});

test('tubage : ventilation de l\'espace annulaire absente de la nomenclature → info (§ 15.4)', () => {
  assert.equal(a(controlesNomenclature('G4', [{ composant_code: 'gaine_polylisse' }], {}), 'ventilation_annulaire').niveau, 'info');
  assert.equal(a(controlesNomenclature('G4', [{ composant_code: 'plaque_ventilee' }], {}), 'ventilation_annulaire'), undefined);
  assert.equal(a(controlesNomenclature('G1', [], {}), 'ventilation_annulaire'), undefined);
});

test('ventouse : vertical ≥ 1,50 m (ou notice) avant le coude ; bâtiment récent ou ERP (Cahier 3708)', () => {
  assert.equal(a(c6({ ...G6, hSortie: 2 }), 'ventouse_vertical').niveau, 'warn'); // 0,95 m
  assert.equal(a(c6(G6), 'ventouse_vertical'), undefined); // 1,75 m
  assert.equal(a(c6({ ...G6, hVerticalNotice: 2 }), 'ventouse_vertical').niveau, 'warn');
  assert.equal(a(c6({ ...G6, batimentRecentOuErp: 'oui' }), 'ventouse_batiment').niveau, 'warn');
  assert.equal(a(c6({ ...G6, batimentRecentOuErp: 'non' }), 'ventouse_batiment'), undefined);
  assert.equal(a(c6(G6), 'ventouse_batiment').niveau, 'verifier');
});

test('points à vérifier : dérivés du gabarit et de la nature, jamais bloquants', () => {
  const codes = (code, conf) => pointsAVerifier(code, conf).map((x) => x.code);
  assert.ok(codes('G4', TRAD).includes('diagnostic_existant') && codes('G4', TRAD).includes('gabarit_passage'));
  assert.ok(codes('G1', TRAD).includes('distance_securite') && codes('G1', TRAD).includes('coffrage'));
  assert.ok(codes('G6', ETANCHE_GRANULES).includes('terminal_ouvrant'));
  assert.ok(!codes('G5', TRAD).includes('plaque_signaletique'));
  assert.ok(codes('G1', TRAD).includes('plaque_signaletique'));
  assert.ok(pointsAVerifier('G1', ETANCHE_GRANULES).find((x) => x.code === 'distance_securite').source.includes('Avis Technique'));
  assert.ok(pointsAVerifier('G3', TRAD).every((x) => x.niveau === 'verifier' && x.source));
});

test('relevé minimal sans aucun complément : aucune règle ne plante ni ne dit « conforme » à tort', () => {
  for (const alertes of [c1(G1), c3(G3), c4(G4), c6(G6)]) {
    assert.ok(alertes.every((x) => ['ok', 'info', 'warn', 'verifier'].includes(x.niveau) && x.message && x.source));
    assert.ok(alertes.filter((x) => x.niveau === 'ok').every((x) => x.code === 'zone1'));
  }
});
