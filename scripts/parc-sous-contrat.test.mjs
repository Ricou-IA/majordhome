// scripts/parc-sous-contrat.test.mjs — répartition du parc sous contrat (src/lib/parcSousContrat.js)
// node --test scripts/parc-sous-contrat.test.mjs
//
// Ce qui ne se voit pas à l'écran : un contrat à 2 équipements de la même
// famille compte UNE fois dans la famille ; les équipements sans type et les
// contrats sans équipement restent visibles ; l'ordre est celui du référentiel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexReferentiel } from '../src/lib/equipmentReferential.js';
import {
  agregerParc, trancheEquipements, formatPart,
  LABEL_SANS_TYPE, LABEL_SANS_CATEGORIE, LABEL_SANS_EQUIPEMENT,
} from '../src/lib/parcSousContrat.js';

const index = indexReferentiel({
  categories: [
    { id: 'cat-poele', code: 'poele', label: 'Poêle', sort_order: 1 },
    { id: 'cat-pac', code: 'pac_air_air', label: 'PAC Air/Air', sort_order: 2 },
  ],
  equipmentTypes: [
    { id: 't-bois', label: 'Poêle à bois ou Insert', category_id: 'cat-poele', sort_order: 1 },
    { id: 't-gran', label: 'Poêle à granulés', category_id: 'cat-poele', sort_order: 2 },
    { id: 't-pac', label: 'PAC Air/Air', category_id: 'cat-pac', sort_order: 1 },
  ],
});

const ligne = (contract_id, equipment_id, equipment_type_id, category_id) => ({ contract_id, equipment_id, equipment_type_id, category_id });

test('agregerParc — familles et types dans l’ordre du référentiel, contrats distincts', () => {
  const r = agregerParc([
    ligne('c1', 'e1', 't-gran', 'cat-poele'),
    ligne('c1', 'e2', 't-gran', 'cat-poele'), // 2 granulés sur le même contrat
    ligne('c2', 'e3', 't-bois', 'cat-poele'),
    ligne('c3', 'e4', 't-pac', 'cat-pac'),
    ligne('c3', 'e5', 't-gran', 'cat-poele'), // multi-familles
  ], index);

  assert.equal(r.contrats, 3);
  assert.equal(r.equipements, 5);
  assert.equal(r.contratsSansEquipement, 0);
  assert.deepEqual(r.familles.map((f) => f.label), ['Poêle', 'PAC Air/Air']);

  const poele = r.familles[0];
  assert.equal(poele.contrats, 3, 'c1, c2, c3 touchent la famille Poêle');
  assert.equal(poele.equipements, 4);
  assert.equal(poele.part, 4 / 5);
  assert.deepEqual(poele.types.map((t) => [t.label, t.contrats, t.equipements]), [
    ['Poêle à bois ou Insert', 1, 1],
    ['Poêle à granulés', 2, 3], // c1 compte UNE fois malgré ses 2 granulés
  ]);

  assert.deepEqual(r.composition.parNombre, [
    { tranche: '0', contrats: 0 }, { tranche: '1', contrats: 1 },
    { tranche: '2', contrats: 2 }, { tranche: '3+', contrats: 0 },
  ]);
  assert.equal(r.composition.monoFamille, 2);
  assert.equal(r.composition.multiFamilles, 1);
  assert.deepEqual(r.composition.combinaisons, [
    { label: 'Poêle', familles: 1, contrats: 2 },
    { label: 'Poêle + PAC Air/Air', familles: 2, contrats: 1 },
  ]);
});

test('agregerParc — sans type, non catégorisé et sans équipement restent visibles, en dernier', () => {
  const r = agregerParc([
    ligne('c1', 'e1', null, 'cat-poele'),      // poêle sans type
    ligne('c2', 'e2', null, null),             // ni type ni catégorie
    ligne('c3', null, null, null),             // contrat sans équipement (LEFT JOIN)
    ligne('c4', 'e4', 't-pac', 'cat-pac'),
  ], index);

  assert.equal(r.contrats, 4);
  assert.equal(r.equipements, 3);
  assert.equal(r.equipementsSansType, 2);
  assert.equal(r.contratsSansEquipement, 1);
  assert.deepEqual(r.familles.map((f) => f.label), ['Poêle', 'PAC Air/Air', LABEL_SANS_CATEGORIE]);
  assert.deepEqual(r.familles[0].types.map((t) => t.label), [LABEL_SANS_TYPE]);
  assert.equal(r.familles[2].id, null);
  assert.equal(r.familles[2].types[0].label, LABEL_SANS_TYPE);
  assert.equal(r.composition.parNombre[0].contrats, 1);
  assert.ok(r.composition.combinaisons.some((c) => c.label === LABEL_SANS_EQUIPEMENT && c.contrats === 1 && c.familles === 0));
});

test('agregerParc — un lien dupliqué ne compte pas deux fois ; type inconnu de l’index → « Sans type »', () => {
  const r = agregerParc([
    ligne('c1', 'e1', 't-gran', 'cat-poele'),
    ligne('c1', 'e1', 't-gran', 'cat-poele'),
    ligne('c2', 'e2', 't-disparu', 'cat-poele'),
  ], index);
  assert.equal(r.equipements, 2);
  assert.deepEqual(r.familles[0].types.map((t) => [t.label, t.equipements]), [
    ['Poêle à granulés', 1], [LABEL_SANS_TYPE, 1],
  ]);
});

test('agregerParc — entrée vide', () => {
  const r = agregerParc([], index);
  assert.equal(r.contrats, 0);
  assert.equal(r.equipements, 0);
  assert.deepEqual(r.familles, []);
  assert.equal(r.composition.combinaisons.length, 0);
});

test('trancheEquipements / formatPart', () => {
  assert.deepEqual([0, 1, 2, 3, 7].map(trancheEquipements), ['0', '1', '2', '3+', '3+']);
  assert.equal(formatPart(0), '0 %');
  assert.equal(formatPart(0.004), '< 1 %');
  assert.equal(formatPart(0.563), '56 %');
  assert.equal(formatPart(1), '100 %');
});
