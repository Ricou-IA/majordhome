// scripts/devis-caracteristiques.test.mjs
// Caractéristiques d'un article imprimées sous une ligne de devis (src/lib/devisCaracteristiques.js).
// Run : node --test scripts/devis-caracteristiques.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lignesCaracteristiques, pdfSafe, figerCaracteristiques } from '../src/lib/devisCaracteristiques.js';

test('canonique dans l\'ordre du schéma, formats FR, booléen vrai seulement, enum libellée', () => {
  const champs = [
    { key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' },
    { key: 'efficiency_pct', label: 'Rendement', unit: '%', type: 'number' },
    { key: 'energy_class', label: 'Classe énergétique', type: 'enum', options: [{ value: 'A+', label: 'A+' }] },
    { key: 'eco_design_2022', label: 'Eco Design 2022', type: 'boolean' },
    { key: 'direct_air', label: 'Air direct', type: 'boolean' },
  ];
  const article = { category: 'poele', specs: { canonical: { efficiency_pct: 92.5, power_nominal_kw: 8, energy_class: 'A+', eco_design_2022: true, direct_air: false } } };
  assert.deepEqual(lignesCaracteristiques(article, champs), ['Puissance nominale : 8 kW', 'Rendement : 92,5 %', 'Classe énergétique : A+', 'Eco Design 2022 : oui']);
});

test('enum : libellé de l\'option par value ; option en chaîne ; valeur inconnue telle quelle', () => {
  const champs = [{
    key: 'type', label: 'Type', type: 'enum',
    options: [{ value: 'bois', label: 'Bois bûche' }, 'granule'],
  }];
  const ligne = (v) => lignesCaracteristiques({ specs: { canonical: { type: v } } }, champs);
  assert.deepEqual(ligne('bois'), ['Type : Bois bûche']);
  assert.deepEqual(ligne('granule'), ['Type : granule']);
  assert.deepEqual(ligne('mixte'), ['Type : mixte']);
});

test('valeurs vides sautées dans le canonique (null, undefined, chaîne vide) ; texte rogné', () => {
  const champs = [
    { key: 'a', label: 'A', type: 'text' },
    { key: 'b', label: 'B', type: 'number', unit: 'kg' },
    { key: 'c', label: 'C', type: 'text' },
    { key: 'd', label: 'D', type: 'text' },
  ];
  const article = { specs: { canonical: { a: '  ', b: null, c: '  Fonte ', d: undefined } } };
  assert.deepEqual(lignesCaracteristiques(article, champs), ['C : Fonte']);
});

test('sans schéma : canonical ignoré, extras imprimés dans l\'ordre ; valeurs vides sautées', () => {
  const article = { category: 'climatisation', specs: { canonical: { kw: 3.5 }, extras: [{ label: 'SCOP', value: '4,6' }, { label: '', value: 'x' }, { label: 'Niveau sonore', value: 19, unit: 'dB' }] } };
  assert.deepEqual(lignesCaracteristiques(article, []), ['SCOP : 4,6', 'Niveau sonore : 19 dB']);
});

test('extras : valeur vide ou libellé blanc sautés, nombre décimal en virgule FR, canonique avant extras', () => {
  const champs = [{ key: 'p', label: 'Puissance', unit: 'kW', type: 'number' }];
  const article = {
    specs: {
      canonical: { p: 3.5 },
      extras: [{ label: 'Poids', value: 12.5, unit: 'kg' }, { label: 'Vide', value: '  ' }, { label: '   ', value: 'x' }, { label: 'Nul', value: null }],
    },
  };
  assert.deepEqual(lignesCaracteristiques(article, champs), ['Puissance : 3,5 kW', 'Poids : 12,5 kg']);
});

test('chaque ligne est PDF-safe (glyphes hors cp1252 remplacés)', () => {
  const champs = [{ key: 't', label: 'Température ≥', type: 'text' }];
  const article = { specs: { canonical: { t: '≤ 40 °C' }, extras: [{ label: 'Dim', value: '3 × 4' }] } };
  assert.deepEqual(lignesCaracteristiques(article, champs), ['Température >= : <= 40 °C', 'Dim : 3 x 4']);
});

test('pdfSafe remplace les glyphes hors cp1252', () => { assert.equal(pdfSafe('T° ≥ 5 °C → ok'), 'T° >= 5 °C -> ok'); });

test('pdfSafe : tous les glyphes visés, espaces insécables, trim', () => {
  assert.equal(pdfSafe('  ≤ ≈ − ↔ ×  '), '<= ~ - <-> x');
});

test('figerCaracteristiques : seules les lignes cochées avec article reçoivent des caractéristiques', () => {
  const champs = [{ key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' }];
  const articlesParId = {
    a1: { id: 'a1', category: 'poele', specs: { canonical: { power_nominal_kw: 8 } } },
  };
  const appels = [];
  const champsParCategorie = (cat) => { appels.push(cat); return cat === 'poele' ? champs : []; };
  const lines = [
    { id: 'l1', show_specs: true, catalog_item_id: 'a1' },
    { id: 'l2', show_specs: true, catalog_item_id: null },
    { id: 'l3', show_specs: false, catalog_item_id: 'a1' },
    { id: 'l4', show_specs: true, catalog_item_id: 'inconnu' },
  ];
  const copie = JSON.parse(JSON.stringify(lines));

  const out = figerCaracteristiques(lines, articlesParId, champsParCategorie);

  assert.deepEqual(out[0].caracteristiques, ['Puissance nominale : 8 kW']);
  assert.deepEqual(out[1].caracteristiques, []);
  assert.deepEqual(out[2].caracteristiques, []);
  assert.deepEqual(out[3].caracteristiques, []);
  assert.deepEqual(appels, ['poele']);
  // autres propriétés conservées
  assert.equal(out[0].id, 'l1');
  assert.equal(out[0].catalog_item_id, 'a1');
  // nouveaux objets, entrée non mutée
  out.forEach((o, i) => assert.notEqual(o, lines[i]));
  assert.deepEqual(lines, copie);
});

test('article sans specs : tableau vide, pas d\'exception', () => {
  assert.deepEqual(lignesCaracteristiques({ category: 'poele' }, [{ key: 'a', label: 'A', type: 'text' }]), []);
  assert.deepEqual(lignesCaracteristiques(null, []), []);
  assert.deepEqual(lignesCaracteristiques({ specs: { canonical: null, extras: null } }, undefined), []);
});

test('figerCaracteristiques : une Map (retour du hook) fige la ligne comme un objet', () => {
  const champs = [{ key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' }];
  const articles = new Map([['a1', { id: 'a1', category: 'poele', specs: { canonical: { power_nominal_kw: 8 } } }]]);
  const out = figerCaracteristiques(
    [{ id: 'l1', show_specs: true, catalog_item_id: 'a1' }, { id: 'l2', show_specs: true, catalog_item_id: 'inconnu' }],
    articles,
    (cat) => (cat === 'poele' ? champs : []),
  );
  assert.deepEqual(out[0].caracteristiques, ['Puissance nominale : 8 kW']);
  assert.deepEqual(out[1].caracteristiques, []);
});
