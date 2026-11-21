import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METIERS, etatMetier, basculerFamille, planMiseAuParc, planRetraitDuParc, ajoutsHorsCatalogue } from '../src/lib/activite/metiers.js';
import { DEFAULT_FAMILLES } from '../src/lib/devisConfig.js';
import { CERTIFICATE_PROFILES } from '../src/lib/equipmentReferential.js';
import { GABARITS_RECEPTION } from '../src/lib/pvPoints.js';

const metier = (key) => METIERS.find((m) => m.key === key);

test('le catalogue couvre chaque type de projet proposé, une fois', () => {
  const familles = METIERS.map((m) => m.famille).filter(Boolean);
  assert.equal(new Set(familles).size, familles.length);
  assert.deepEqual([...familles].sort(), DEFAULT_FAMILLES.map((f) => f.key).sort());
});

test('le catalogue ne cite que des gabarits connus, des codes valides et pas deux fois le même type', () => {
  const profils = new Set(CERTIFICATE_PROFILES.map((p) => p.value));
  const codesTypes = [];
  for (const m of METIERS) {
    assert.equal(Boolean(m.categorie), Boolean(m.type), m.key);
    if (!m.type) continue;
    assert.ok(profils.has(m.categorie.certificate_profile), m.key);
    assert.ok(GABARITS_RECEPTION.includes(m.type.reception_profile), m.key);
    assert.match(m.categorie.code, /^[a-z0-9_]+$/);
    assert.match(m.type.code, /^[a-z0-9_]+$/);
    codesTypes.push(m.type.code, ...(m.type.alias || []));
  }
  assert.equal(new Set(codesTypes).size, codesTypes.length);
});

test('une entreprise neuve : rien de coché, tout est à créer', () => {
  const r = { familles: [{ key: 'autre', actif: true }], categories: [], types: [] };
  assert.deepEqual(etatMetier(metier('poele_granules'), r), { projet: false, parc: false });
  assert.deepEqual(etatMetier(metier('batterie'), r), { projet: false, parc: null });
  assert.deepEqual(etatMetier(metier('chaudiere_bois'), r), { projet: null, parc: false });
  const plan = planMiseAuParc(metier('poele_granules'), r);
  assert.equal(plan.categorie.action, 'creer');
  assert.equal(plan.categorie.payload.code, 'poele');
  assert.equal(plan.type.action, 'creer');
  assert.equal(plan.type.payload.category_id, null);
});

test('un référentiel existant est reconnu par ses codes, sans rien recréer', () => {
  const categories = [{ id: 'c1', code: 'poele', is_active: true, sort_order: 3 }];
  const types = [{ id: 't1', code: 'poele_granules_elec', category_id: 'c1', is_active: true, sort_order: 7 }];
  const r = { familles: [], categories, types };
  assert.equal(etatMetier(metier('poele_granules'), r).parc, true);
  const plan = planMiseAuParc(metier('poele_granules'), r);
  assert.equal(plan.categorie.action, 'rien');
  assert.equal(plan.type.action, 'rien');
  // Le poêle à bois partage la catégorie : seul son type est créé, dans la catégorie existante, rangé en fin.
  const bois = planMiseAuParc(metier('poele_bois'), r);
  assert.equal(bois.categorie.action, 'rien');
  assert.equal(bois.type.action, 'creer');
  assert.equal(bois.type.payload.category_id, 'c1');
  assert.equal(bois.type.payload.sort_order, 8);
});

test('un type actif dans une catégorie inactive n’est pas au parc, et la remise au parc réactive la catégorie', () => {
  const categories = [{ id: 'c1', code: 'pac_air_air', is_active: false }];
  const types = [{ id: 't1', code: 'pac_air_air', category_id: 'c1', is_active: true }];
  const r = { familles: [], categories, types };
  assert.equal(etatMetier(metier('climatisation'), r).parc, false);
  const plan = planMiseAuParc(metier('climatisation'), r);
  assert.equal(plan.categorie.action, 'reactiver');
  assert.equal(plan.type.action, 'rien');
});

test('retirer du parc désactive les types, et la catégorie seulement si plus rien n’y est actif', () => {
  const categories = [{ id: 'c1', code: 'poele', is_active: true }];
  const types = [
    { id: 't1', code: 'poele_granules', category_id: 'c1', is_active: true },
    { id: 't2', code: 'poele_bois', category_id: 'c1', is_active: true },
  ];
  assert.deepEqual(planRetraitDuParc(metier('poele_granules'), { categories, types }), { types: ['t1'], categories: [] });
  const seul = [{ ...types[0] }, { ...types[1], is_active: false }];
  assert.deepEqual(planRetraitDuParc(metier('poele_granules'), { categories, types: seul }), { types: ['t1'], categories: ['c1'] });
});

test('basculer un type de projet ne touche que lui', () => {
  const f = [{ key: 'vmc', actif: false }, { key: 'autre', actif: true }];
  assert.deepEqual(basculerFamille(f, 'vmc', true), [{ key: 'vmc', actif: true }, { key: 'autre', actif: true }]);
});

test('les ajouts de l’entreprise hors catalogue sont listés à part', () => {
  const r = ajoutsHorsCatalogue({
    familles: [{ key: 'vmc' }, { key: 'libre_1', label: 'Isolation' }],
    types: [{ code: 'poele_hydro' }, { code: 'gainable' }],
  });
  assert.deepEqual(r.familles.map((f) => f.key), ['libre_1']);
  assert.deepEqual(r.types.map((t) => t.code), ['poele_hydro']);
});
