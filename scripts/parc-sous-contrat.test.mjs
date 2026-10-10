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

// ---------------------------------------------------------------------------
// Arbre Famille → Type → Marque → Modèle → Contrat
// ---------------------------------------------------------------------------
import { construireArbreParc, filtrerArbre, LABEL_SANS_MARQUE, LABEL_SANS_MODELE } from '../src/lib/parcSousContrat.js';

const feuille = (contract_id, equipment_id, equipment_type_id, category_id, extra = {}) => ({
  contract_id, equipment_id, equipment_type_id, category_id,
  contract_number: `CTR-${contract_id}`, client_id: `cl-${contract_id}`, client_name: `Client ${contract_id}`, client_city: 'Gaillac',
  ...extra,
});

test('construireArbreParc — 5 niveaux, marques regroupées sans tenir compte de la casse, contrat compté une fois', () => {
  const { racines, equipements, contrats } = construireArbreParc([
    feuille('c1', 'e1', 't-gran', 'cat-poele', { brand: 'Rika', model: 'Domo' }),
    feuille('c1', 'e2', 't-gran', 'cat-poele', { brand: 'RIKA ', model: 'Domo' }), // même marque, autre casse
    feuille('c2', 'e3', 't-gran', 'cat-poele', { brand: 'MCZ', model: '' }),
    feuille('c3', 'e4', 't-pac', 'cat-pac', { brand: null, model: null, client_city: 'Albi' }),
    feuille('c4', null, null, null), // contrat sans équipement : pas de feuille
  ], index);

  assert.equal(equipements, 4);
  assert.equal(contrats, 3);
  assert.deepEqual(racines.map((r) => [r.niveau, r.label, r.equipements, r.contrats]), [
    ['famille', 'Poêle', 3, 2], ['famille', 'PAC Air/Air', 1, 1],
  ]);
  const gran = racines[0].enfants[0];
  assert.equal(gran.niveau, 'type');
  assert.equal(gran.label, 'Poêle à granulés');
  assert.deepEqual(gran.enfants.map((m) => [m.niveau, m.label, m.equipements, m.contrats]), [
    ['marque', 'Rika', 2, 1], ['marque', 'MCZ', 1, 1],
  ]);
  const domo = gran.enfants[0].enfants[0];
  assert.equal(domo.niveau, 'modele');
  assert.equal(domo.label, 'Domo');
  assert.equal(domo.enfants.length, 1, 'c1 : une seule feuille malgré ses 2 poêles identiques');
  assert.deepEqual(domo.enfants[0].contrat, { id: 'c1', numero: 'CTR-c1', clientId: 'cl-c1', clientNom: 'Client c1', clientVille: 'Gaillac' });
  assert.equal(domo.enfants[0].equipements, 2);
  assert.equal(domo.enfants[0].niveau, 'contrat');
  assert.equal(domo.enfants[0].enfants.length, 0);

  const mcz = gran.enfants[1];
  assert.equal(mcz.enfants[0].label, LABEL_SANS_MODELE);
  assert.equal(mcz.enfants[0].aQualifier, true);
  const pac = racines[1].enfants[0].enfants[0];
  assert.equal(pac.label, LABEL_SANS_MARQUE);
  assert.equal(pac.aQualifier, true);
  assert.ok(racines.every((r) => r.key.startsWith('/')), 'clés hiérarchiques uniques');
});

test('filtrerArbre — garde la branche des correspondances, recalcule les compteurs, dit quoi ouvrir', () => {
  const { racines } = construireArbreParc([
    feuille('c1', 'e1', 't-gran', 'cat-poele', { brand: 'Rika', model: 'Domo' }),
    feuille('c2', 'e3', 't-gran', 'cat-poele', { brand: 'MCZ', model: 'Ego', client_name: 'Durand Émile' }),
    feuille('c3', 'e4', 't-pac', 'cat-pac', { brand: 'Daikin', model: 'Perfera' }),
  ], index);

  const r = filtrerArbre(racines, 'durand');
  assert.equal(r.equipements, 1);
  assert.equal(r.contrats, 1);
  assert.equal(r.racines.length, 1);
  assert.deepEqual([r.racines[0].label, r.racines[0].equipements, r.racines[0].contrats], ['Poêle', 1, 1]);
  const marques = r.racines[0].enfants[0].enfants;
  assert.deepEqual(marques.map((m) => m.label), ['MCZ']);
  assert.ok(r.aOuvrir.has(r.racines[0].key));
  assert.ok(r.aOuvrir.has(marques[0].key), 'la marque est un ancêtre de la correspondance');
  assert.equal(r.racines[0].part, 1);

  // Terme accentué / casse : « DURAND É » trouve « Durand Émile »
  assert.equal(filtrerArbre(racines, 'DURAND É').contrats, 1);
  // Un nœud qui correspond garde toute sa descendance (ici la marque)
  const parMarque = filtrerArbre(racines, 'rika');
  assert.equal(parMarque.racines[0].enfants[0].enfants[0].enfants[0].enfants[0].contrat.id, 'c1');
  // Numéro de contrat et ville sont cherchables
  assert.equal(filtrerArbre(racines, 'ctr-c3').contrats, 1);
  // Rien ne correspond → arbre vide, zéro, et rien à ouvrir
  const vide = filtrerArbre(racines, 'zzz');
  assert.deepEqual([vide.racines.length, vide.equipements, vide.contrats, vide.aOuvrir.size], [0, 0, 0, 0]);
  // Sans terme → arbre intact
  const tout = filtrerArbre(racines, '  ');
  assert.equal(tout.racines, racines);
  assert.deepEqual([tout.equipements, tout.contrats], [3, 3]);
});
