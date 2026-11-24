import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrerReglages } from '../src/lib/rechercheReglages.js';

const groupes = [
  { key: 'socle', label: 'Socle', tiles: [
    { key: 'organization', title: 'Entreprise', description: 'Identité, coordonnées, siège et territoire' },
    { key: 'pennylane', title: 'Pennylane', description: 'Lien Pennylane, mentions et coordonnées bancaires' },
  ] },
  { key: 'communication', label: 'Communication', tiles: [
    { key: 'communication', title: 'E-mails & SMS', description: 'Votre adresse d’envoi, les SMS' },
  ] },
];

test('recherche sans accents ni casse, sur titre, description et module', () => {
  assert.deepEqual(filtrerReglages(groupes, 'identite').map((g) => g.tiles.map((t) => t.key)), [['organization']]);
  assert.deepEqual(filtrerReglages(groupes, 'COORDONNÉES').flatMap((g) => g.tiles.map((t) => t.key)), ['organization', 'pennylane']);
  assert.deepEqual(filtrerReglages(groupes, 'communication sms').flatMap((g) => g.tiles.map((t) => t.key)), ['communication']);
});

test('aucun terme : tout ; aucun résultat : liste vide', () => {
  assert.equal(filtrerReglages(groupes, '  ').length, 2);
  assert.deepEqual(filtrerReglages(groupes, 'introuvable'), []);
});
