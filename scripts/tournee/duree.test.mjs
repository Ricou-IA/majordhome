// scripts/tournee/duree.test.mjs
// Tests du calcul de durée d'intervention (src/lib/tournee/duree.js).
// Run : node --test scripts/tournee/duree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dureeEquipement, dureeContrat, construireFallbacks } from '../../src/lib/tournee/duree.js';

const T_POELE_GRAN = { duration_base_minutes: 90, duration_per_extra_unit_minutes: 0, included_units: 1 };
const T_POELE_BOIS = { duration_base_minutes: 60, duration_per_extra_unit_minutes: 0, included_units: 1 };
const T_PAC_AIR_AIR = { duration_base_minutes: 60, duration_per_extra_unit_minutes: 30, included_units: 1 };
const T_CHAUD_BOIS = { duration_base_minutes: 150, duration_per_extra_unit_minutes: 0, included_units: 1 };

test('dureeEquipement — type simple, unit_count ignoré', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, T_POELE_GRAN, 90), 90);
  assert.equal(dureeEquipement({ unit_count: 3 }, T_POELE_GRAN, 90), 90);
});

test('dureeEquipement — multi-split : +30 par unité AU-DELA de included_units', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, T_PAC_AIR_AIR, 90), 60, 'mono-split = 1h');
  assert.equal(dureeEquipement({ unit_count: 2 }, T_PAC_AIR_AIR, 90), 90, 'bi-split = 1h30');
  assert.equal(dureeEquipement({ unit_count: 3 }, T_PAC_AIR_AIR, 90), 120, 'tri-split = 2h');
});

test('dureeEquipement — unit_count absent vaut 1', () => {
  assert.equal(dureeEquipement({}, T_PAC_AIR_AIR, 90), 60);
});

test('dureeEquipement — type absent ou sans durée renseignée retombe sur le fallback', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, null, 90), 90);
  assert.equal(dureeEquipement({ unit_count: 1 }, { duration_base_minutes: null }, 150), 150);
});

test('dureeContrat — somme des équipements', () => {
  const types = new Map([['a', T_POELE_GRAN], ['b', T_PAC_AIR_AIR]]);
  const equipements = [
    { equipment_type_id: 'a', category_id: 'poele', unit_count: 1 },
    { equipment_type_id: 'b', category_id: 'pac_air_air', unit_count: 2 },
  ];
  assert.equal(dureeContrat(equipements, types, { parCategorie: {}, defaut: 90 }), 180);
});

test('dureeContrat — équipement non typé prend le fallback de SA catégorie', () => {
  const types = new Map();
  const fallbacks = { parCategorie: { poele: 90, chaudiere_bois: 150 }, defaut: 90 };
  assert.equal(dureeContrat([{ category_id: 'chaudiere_bois' }], types, fallbacks), 150);
  assert.equal(dureeContrat([{ category_id: 'poele' }], types, fallbacks), 90);
  assert.equal(dureeContrat([{ category_id: 'inconnue' }], types, fallbacks), 90);
});

test('dureeContrat — contrat vide = 0', () => {
  assert.equal(dureeContrat([], new Map(), { parCategorie: {}, defaut: 90 }), 0);
});

test('construireFallbacks — durée du type DOMINANT de chaque catégorie', () => {
  // Parc : 3 poêles granulés (90) + 1 poêle bois (60) -> dominant poele = 90.
  //        2 chaudières bois (150) -> dominant chaudiere_bois = 150.
  const typesById = new Map([['g', T_POELE_GRAN], ['b', T_POELE_BOIS], ['c', T_CHAUD_BOIS]]);
  const parc = [
    { equipment_type_id: 'g', category_id: 'poele' },
    { equipment_type_id: 'g', category_id: 'poele' },
    { equipment_type_id: 'g', category_id: 'poele' },
    { equipment_type_id: 'b', category_id: 'poele' },
    { equipment_type_id: 'c', category_id: 'chaudiere_bois' },
    { equipment_type_id: 'c', category_id: 'chaudiere_bois' },
  ];
  const fb = construireFallbacks(parc, typesById, 90);
  assert.equal(fb.parCategorie.poele, 90);
  assert.equal(fb.parCategorie.chaudiere_bois, 150);
  assert.equal(fb.defaut, 90);
});

test('construireFallbacks — catégorie sans aucun équipement typé reste absente', () => {
  const fb = construireFallbacks([{ category_id: 'vmc' }], new Map(), 90);
  assert.equal(fb.parCategorie.vmc, undefined);
});

test('dureeContrat : gain multi-équipements dès 2 lignes (barème = interventions isolées, Eric 2026-09-12) ; une seule ligne à unit_count > 1 n est pas « multi »', () => {
  const types = new Map([
    ['clim', { duration_base_minutes: 60, duration_per_extra_unit_minutes: 30, included_units: 1 }],
    ['bois', { duration_base_minutes: 60, duration_per_extra_unit_minutes: 0, included_units: 1 }],
  ]);
  const gomes = [
    { equipment_type_id: 'clim', category: 'pac_air_air', unit_count: 1 },
    { equipment_type_id: 'clim', category: 'pac_air_air', unit_count: 1 },
    { equipment_type_id: 'clim', category: 'pac_air_air', unit_count: 1 },
    { equipment_type_id: 'bois', category: 'poele', unit_count: 1 },
  ];
  assert.equal(dureeContrat(gomes, types, { parCategorie: {}, defaut: 90 }), 240, 'sans réglage : somme brute');
  assert.equal(dureeContrat(gomes, types, { parCategorie: {}, defaut: 90 }, { gainMultiPct: 10 }), 216);
  assert.equal(dureeContrat([{ equipment_type_id: 'clim', category: 'pac_air_air', unit_count: 3 }], types, { parCategorie: {}, defaut: 90 }, { gainMultiPct: 10 }), 120, 'une ligne à 3 unités : dégressif du barème, pas de gain multi');
  assert.equal(dureeContrat([{ equipment_type_id: 'bois', category: 'poele', unit_count: 1 }], types, { parCategorie: {}, defaut: 90 }, { gainMultiPct: 10 }), 60);
});
