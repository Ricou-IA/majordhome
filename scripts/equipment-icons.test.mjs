import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipmentKind, buildKindsByClient, KIND_ORDER } from '../src/lib/equipmentIcons.js';

test('equipmentKind — bûche : bois par code tarifaire', () => {
  assert.equal(equipmentKind({ type_code: 'poele_bois_insert', category: 'poele' }), 'buche');
  assert.equal(equipmentKind({ type_code: 'chaudiere_bois', category: 'chaudiere_bois' }), 'buche');
});

test('equipmentKind — flamme : granulés par code tarifaire', () => {
  assert.equal(equipmentKind({ type_code: 'poele_granules_elec', category: 'poele' }), 'flamme');
  assert.equal(equipmentKind({ type_code: 'poele_granules_sans_elec', category: 'poele' }), 'flamme');
  assert.equal(equipmentKind({ type_code: 'chaudiere_granules', category: 'chaudiere_bois' }), 'flamme');
});

test('equipmentKind — flocon : clim/PAC par code tarifaire', () => {
  assert.equal(equipmentKind({ type_code: 'pac_air_air', category: 'pac_air_air' }), 'flocon');
  assert.equal(equipmentKind({ type_code: 'pac_air_eau', category: 'pac_air_eau' }), 'flocon');
  assert.equal(equipmentKind({ type_code: 'gainable', category: 'climatisation' }), 'flocon');
});

test('equipmentKind — flocon : la catégorie froid suffit sans type précis', () => {
  // Une clim sans type tarifaire reste identifiable (pas d'ambiguïté bois/granulés)
  assert.equal(equipmentKind({ type_code: null, category: 'pac_air_air' }), 'flocon');
  assert.equal(equipmentKind({ type_code: null, category: 'pac_air_eau' }), 'flocon');
  assert.equal(equipmentKind({ type_code: null, category: 'climatisation' }), 'flocon');
});

test('equipmentKind — rien si bois/granulés indistinguable (règle produit)', () => {
  // Poêle ou chaudière sans type précis : impossible de trancher bûche vs flamme
  assert.equal(equipmentKind({ type_code: null, category: 'poele' }), null);
  assert.equal(equipmentKind({ type_code: null, category: 'chaudiere_bois' }), null);
  // Poêle hydro : bois OU granulés selon modèle → ambigu, pas d'icône
  assert.equal(equipmentKind({ type_code: 'poele_hydro', category: 'poele' }), null);
});

test('equipmentKind — rien pour les équipements hors périmètre', () => {
  assert.equal(equipmentKind({ type_code: 'ballon_thermo', category: 'chauffe_eau_thermo' }), null);
  assert.equal(equipmentKind({ type_code: null, category: 'vmc' }), null);
  assert.equal(equipmentKind({ type_code: null, category: 'autre' }), null);
  assert.equal(equipmentKind({ type_code: 'panneau_photovoltaique', category: 'autre' }), null);
  assert.equal(equipmentKind({}), null);
  assert.equal(equipmentKind(null), null);
});

test('equipmentKind — code inconnu : fallback sur la catégorie froid', () => {
  // Un futur code clim ajouté à la grille ne doit pas faire disparaître le flocon
  assert.equal(equipmentKind({ type_code: 'clim_murale_v2', category: 'climatisation' }), 'flocon');
  // Mais un code inconnu sur une catégorie ambiguë reste sans icône
  assert.equal(equipmentKind({ type_code: 'poele_mystere', category: 'poele' }), null);
});

test('buildKindsByClient — 1 icône par équipement, groupées par client', () => {
  const rows = [
    { client_id: 'c1', type_code: 'poele_granules_elec', category: 'poele', type_label: 'Poêle à granulés (électronique)' },
    { client_id: 'c1', type_code: 'poele_granules_elec', category: 'poele', type_label: 'Poêle à granulés (électronique)' },
    { client_id: 'c2', type_code: 'pac_air_air', category: 'pac_air_air', type_label: 'PAC Air/Air (Climatisation)' },
    { client_id: 'c2', type_code: null, category: 'poele', type_label: null }, // non identifiable → ignoré
  ];
  const map = buildKindsByClient(rows);
  assert.equal(map.get('c1').length, 2); // 2 poêles granulés = 2 flammes
  assert.deepEqual(map.get('c1').map((k) => k.kind), ['flamme', 'flamme']);
  assert.equal(map.get('c2').length, 1);
  assert.equal(map.get('c2')[0].kind, 'flocon');
});

test('buildKindsByClient — tri stable bûche → flamme → flocon', () => {
  const rows = [
    { client_id: 'c1', type_code: 'pac_air_air', category: 'pac_air_air', type_label: 'PAC' },
    { client_id: 'c1', type_code: 'poele_bois_insert', category: 'poele', type_label: 'Poêle à bois' },
    { client_id: 'c1', type_code: 'chaudiere_granules', category: 'chaudiere_bois', type_label: 'Chaudière granulés' },
  ];
  const map = buildKindsByClient(rows);
  assert.deepEqual(map.get('c1').map((k) => k.kind), KIND_ORDER);
});

test('buildKindsByClient — un client sans équipement identifiable est absent de la map', () => {
  const rows = [{ client_id: 'c1', type_code: null, category: 'poele', type_label: null }];
  const map = buildKindsByClient(rows);
  assert.equal(map.has('c1'), false);
  assert.equal(buildKindsByClient(null).size, 0);
  assert.equal(buildKindsByClient([]).size, 0);
});

test('buildKindsByClient — tooltip = label du type, fallback label du kind', () => {
  const rows = [
    { client_id: 'c1', type_code: 'poele_bois_insert', category: 'poele', type_label: 'Poêle à bois / Insert' },
    { client_id: 'c2', type_code: null, category: 'climatisation', type_label: null },
  ];
  const map = buildKindsByClient(rows);
  assert.equal(map.get('c1')[0].label, 'Poêle à bois / Insert');
  assert.equal(map.get('c2')[0].label, 'Climatisation / PAC');
});
