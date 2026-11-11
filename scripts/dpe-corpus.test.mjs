// node --test scripts/dpe-corpus.test.mjs — correspondance dossier du corpus MonsieurDPE → carte du logement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCorpusDossier, colonnesFiltrables, VERSION_CARTE } from '../src/lib/dpeCorpus.js';
import { buildHeatLossBreakdown, buildCostBreakdown, buildEquipmentDrafts, toClientPatch, isDpeExpired } from '../src/lib/dpeApi.js';

// Dossier réel 2631E0482288Y relevé dans le corpus le 2026-11-12 (coordonnées retirées).
const DOSSIER = {
  identifiant_dpe: '2631E0482288Y', surface_habitable_logement: 114.02, periode_construction: '2013-2021',
  methode_application_dpe: 'dpe maison individuelle', classe_bilan_dpe: 'A', classe_emission_ges: 'A',
  conso_ep_m2: 69, ges_m2: 2, type_energie_chauffage: 'Électricité',
  type_generateur_chauffage: 'PAC air/air installée à partir de 2015', scop_generateur: 3,
  date_etablissement: '2026-02-18', deperdition_enveloppe: 190.43915120410887,
  deperdition_pont_thermique: 33.0647, deperdition_renouvellement_air: 52.231591204108874, deperdition_mur: 28.84476,
  deperdition_plancher_bas: 21.546, deperdition_plancher_haut: 15.9201, deperdition_baie_vitree: 31.455, deperdition_porte: 7.377,
  type_ventilation: 'VMC SF Hygro B après 2012', cout_5_usages: 952.4259719844163, cout_chauffage: 731.898308217561,
  cout_ecs: 123.27809129705892, cout_eclairage: 52.388527370122084, cout_auxiliaires: 30.597660137877014,
  cout_refroidissement: 14.263384961797184, qualite_isolation_enveloppe: 'très bonne', qualite_isolation_mur: 'très bonne',
  qualite_isolation_menuiserie: 'bonne', qualite_isolation_plancher_bas: 'très bonne', qualite_isolation_plancher_haut: 'très bonne',
  ubat: 0.358, nombre_niveaux: 1, date_fin_validite: '2036-02-17',
  type_generateur_ecs: 'CET sur air extérieur après 2014', type_energie_ecs: 'Électricité',
};
const DATA = { dossier: DOSSIER, composants: [{ famille: 'mur' }, { famille: 'baie' }] };

test('mapCorpusDossier : chaque champ de la carte vient de sa colonne du corpus', () => {
  const r = mapCorpusDossier(DATA);
  assert.equal(r.dpeNumber, '2631E0482288Y');
  assert.equal(r.dpeLabel, 'A');
  assert.equal(r.gesLabel, 'A');
  assert.equal(r.buildingType, 'maison');
  assert.equal(r.surface, 114.02);
  assert.equal(r.levels, 1);
  assert.equal(r.periodeConstruction, '2013-2021');
  assert.equal(r.heatingGenerator, 'PAC air/air installée à partir de 2015');
  assert.equal(r.heatingEnergy, 'Électricité');
  assert.equal(r.ecsGenerator, 'CET sur air extérieur après 2014');
  assert.equal(r.ventilation, 'VMC SF Hygro B après 2012');
  assert.equal(r.insulationEnvelope, 'très bonne');
  assert.equal(r.insulationWalls, 'très bonne');
  assert.equal(r.insulationWindows, 'bonne');
  assert.equal(r.insulationRoof, 'très bonne');
  assert.equal(r.insulationFloor, 'très bonne');
  assert.equal(r.consoPerM2, 69);
  assert.equal(r.annualCost, 952.4259719844163);
  assert.equal(r.ubat, 0.358);
  assert.equal(r.dpeDate, '2026-02-18');
  assert.equal(r.dpeValidUntil, '2036-02-17');
  assert.equal(r.costs.heating, 731.898308217561);
  assert.equal(r.costs.cooling, 14.263384961797184);
  assert.equal(r.heatLoss.airRenewal, 52.231591204108874);
  assert.equal(r.heatLoss.total, 190.43915120410887);
  assert.equal(r.immeubleDerive, false);
  assert.equal(r.rapportComplet, true);
  // Le corpus ne porte pas la période du générateur de froid : le champ est absent, pas deviné.
  assert.equal(r.coolingPeriod, null);
});

test('mapCorpusDossier : les fonctions de la carte existante s\'appliquent telles quelles', () => {
  const r = mapCorpusDossier(DATA);
  const pertes = buildHeatLossBreakdown(r);
  assert.equal(pertes[0].key, 'airRenewal');
  assert.ok(Math.abs(pertes.reduce((s, p) => s + p.share, 0) - 100) < 0.5);
  assert.equal(buildCostBreakdown(r)[0].key, 'heating');
  assert.deepEqual(buildEquipmentDrafts(r).map((d) => d.key), ['heating', 'ventilation']);
  assert.deepEqual(toClientPatch(r), { dpeNumber: '2631E0482288Y', surface: '114.02', housingType: 'maison' });
  assert.equal(isDpeExpired(r, new Date('2026-11-12')), false);
});

test('mapCorpusDossier : dossier sans composant archivé ⇒ pas de rapport complet', () => {
  assert.equal(mapCorpusDossier({ dossier: DOSSIER, composants: [] }).rapportComplet, false);
});

test('mapCorpusDossier : appartement dérivé de l\'immeuble ⇒ pertes masquées (piège d\'échelle), pas de rapport complet', () => {
  const r = mapCorpusDossier({ dossier: { ...DOSSIER, methode_application_dpe: 'dpe appartement généré à partir des données DPE immeuble' }, composants: [{}] });
  assert.equal(r.immeubleDerive, true);
  assert.equal(r.rapportComplet, false);
  assert.equal(r.buildingType, 'appartement');
  assert.deepEqual(buildHeatLossBreakdown(r), []);
});

test('mapCorpusDossier : immeuble et appartement individuel', () => {
  assert.equal(mapCorpusDossier({ dossier: { ...DOSSIER, methode_application_dpe: 'dpe appartement individuel' }, composants: [{}] }).buildingType, 'appartement');
  assert.equal(mapCorpusDossier({ dossier: { ...DOSSIER, methode_application_dpe: 'dpe immeuble collectif' }, composants: [{}] }).buildingType, 'immeuble');
});

test('mapCorpusDossier : champs absents ⇒ null, jamais undefined ni NaN ; données vides ⇒ null', () => {
  const r = mapCorpusDossier({ dossier: { identifiant_dpe: '2631E0482288Y' }, composants: [] });
  assert.equal(r.dpeLabel, null);
  assert.equal(r.surface, null);
  assert.equal(r.heatLoss.walls, null);
  assert.equal(r.costs.total, null);
  assert.equal(r.buildingType, null);
  assert.equal(mapCorpusDossier(null), null);
  assert.equal(mapCorpusDossier({ dossier: null }), null);
});

test('colonnesFiltrables : les colonnes typées de client_dpe', () => {
  assert.deepEqual(colonnesFiltrables(mapCorpusDossier(DATA)), {
    etiquette_dpe: 'A', etiquette_ges: 'A', energie_chauffage: 'Électricité',
    generateur_chauffage: 'PAC air/air installée à partir de 2015', surface: 114.02,
    periode_construction: '2013-2021', date_dpe: '2026-02-18', rapport_complet: true,
  });
  assert.ok(Number.isInteger(VERSION_CARTE) && VERSION_CARTE >= 1);
});
