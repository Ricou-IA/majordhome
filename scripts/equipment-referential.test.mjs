// scripts/equipment-referential.test.mjs
// Référentiel équipements (catégories → types) : index, libellés, regroupement.
// Run : node --test scripts/equipment-referential.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexReferentiel, grouperTypesParCategorie, libelleEquipement, typeIdsParCategorie,
  CERTIFICATE_PROFILES, LABEL_NON_CATEGORISE, LABEL_TYPE_INCONNU, PROFIL_GENERIQUE,
} from '../src/lib/equipmentReferential.js';

const CATEGORIES = [
  { id: 'c_pac', code: 'pac_air_air', label: 'PAC Air/Air', sort_order: 20, certificate_profile: 'pac', default_vat_rate: '5.50' },
  { id: 'c_poele', code: 'poele', label: 'Poêle', sort_order: 1, certificate_profile: 'combustion_bois', default_vat_rate: 5.5 },
  { id: 'c_energie', code: 'energie', label: 'Énergie', sort_order: 99, certificate_profile: 'generique', default_vat_rate: 20 },
];
const TYPES = [
  { id: 't_pac', label: 'PAC Air/Air', category_id: 'c_pac', sort_order: 20 },
  { id: 't_granules', label: 'Poêle à granulés', category_id: 'c_poele', sort_order: 2 },
  { id: 't_bois', label: 'Poêle à bois / Insert', category_id: 'c_poele', sort_order: 1 },
  { id: 't_orphelin', label: 'Type orphelin', category_id: 'c_disparue', sort_order: 5 },
];

test('index : tri par sort_order puis libellé, maps par id et par code', () => {
  const ix = indexReferentiel({ categories: CATEGORIES, equipmentTypes: TYPES });
  assert.deepEqual(ix.categories.map((c) => c.code), ['poele', 'pac_air_air', 'energie']);
  assert.deepEqual(ix.equipmentTypes.map((t) => t.id), ['t_bois', 't_granules', 't_orphelin', 't_pac']);
  assert.equal(ix.categoriesByCode.get('poele').id, 'c_poele');
  assert.equal(ix.labelCategorie('c_pac'), 'PAC Air/Air');
  assert.equal(ix.labelCategorie('inconnue'), LABEL_NON_CATEGORISE);
  assert.equal(ix.labelCategorie(null), LABEL_NON_CATEGORISE);
  assert.equal(ix.labelType('t_bois'), 'Poêle à bois / Insert');
  assert.equal(ix.labelType('nope'), null);
});

test('profil et TVA par code : lus sur la catégorie, générique / null si le code est inconnu', () => {
  const ix = indexReferentiel({ categories: CATEGORIES, equipmentTypes: TYPES });
  assert.equal(ix.profilParCode('poele'), 'combustion_bois');
  assert.equal(ix.profilParCode('vmc'), PROFIL_GENERIQUE);
  assert.equal(ix.tvaParCode('pac_air_air'), 5.5);   // numeric renvoyé en chaîne par PostgREST → nombre
  assert.equal(ix.tvaParCode('vmc'), null);
  assert.ok(ix.codeConnu('poele') && !ix.codeConnu('vmc'));
  assert.ok(CERTIFICATE_PROFILES.some((p) => p.value === PROFIL_GENERIQUE));
  assert.equal(new Set(CERTIFICATE_PROFILES.map((p) => p.value)).size, 7);
});

test('regroupement pour optgroups : ordre des catégories, types triés, orphelins dans un dernier groupe', () => {
  const ix = indexReferentiel({ categories: CATEGORIES, equipmentTypes: TYPES });
  const g = grouperTypesParCategorie(ix);
  assert.deepEqual(g.map((x) => x.label), ['Poêle', 'PAC Air/Air', LABEL_NON_CATEGORISE]);
  assert.deepEqual(g[0].types.map((t) => t.id), ['t_bois', 't_granules']);
  assert.equal(g[2].category, null);
  assert.deepEqual(g[2].types.map((t) => t.id), ['t_orphelin']);
  // une catégorie sans type n'apparaît pas (Énergie), un sous-ensemble de types se regroupe pareil
  assert.deepEqual(grouperTypesParCategorie(ix, [TYPES[0]]).map((x) => x.label), ['PAC Air/Air']);
});

test('libellé d un équipement : type > catégorie > « Équipement » ; type inconnu affiché comme tel', () => {
  const ix = indexReferentiel({ categories: CATEGORIES, equipmentTypes: TYPES });
  assert.equal(libelleEquipement({ equipment_type_id: 't_bois', category_id: 'c_poele' }, ix), 'Poêle à bois / Insert');
  assert.equal(libelleEquipement({ equipment_type_id: null, category_id: 'c_poele' }, ix), 'Poêle');
  assert.equal(libelleEquipement({ equipment_type_id: null, category_id: null }, ix), 'Équipement');
  assert.equal(libelleEquipement({ equipment_type_id: 'zzz', category_id: 'c_poele' }, ix), LABEL_TYPE_INCONNU);
  assert.equal(libelleEquipement(null, ix), 'Équipement');
});

test('typeIdsParCategorie : forme du moteur de tournées, sans le groupe orphelin', () => {
  const ix = indexReferentiel({ categories: CATEGORIES, equipmentTypes: TYPES });
  const m = typeIdsParCategorie(ix);
  assert.deepEqual([...m.entries()], [['c_poele', ['t_bois', 't_granules']], ['c_disparue', ['t_orphelin']], ['c_pac', ['t_pac']]]);
});

test('référentiel vide : aucune exception, libellés de repli', () => {
  const ix = indexReferentiel();
  assert.deepEqual(grouperTypesParCategorie(ix), []);
  assert.equal(ix.labelCategorie('x'), LABEL_NON_CATEGORISE);
  assert.equal(libelleEquipement({}, ix), 'Équipement');
});
