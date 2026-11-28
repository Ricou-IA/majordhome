// Brouillon du métré : écrit après une saisie, résumé sans code interne, daté, ignoré au-delà de 30 jours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brouillonValide, nouveauBrouillon, clesModifiees, ajouterModifies, resumeBrouillon, titreReprise, contradictionFamille } from '../../src/lib/fumisterie/brouillon.js';

const JOUR = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 28, 11, 46); // 28 nov. 2026, 12:46 à Paris

test('brouillonValide : 30 jours, ancien format accepté, sans relevé refusé', () => {
  const d = nouveauBrouillon({ etape: 1, criteres: {}, configurationId: 'x', releve: { hBuse: 1 } }, T0);
  assert.equal(brouillonValide(d, T0 + 29 * JOUR), true);
  assert.equal(brouillonValide(d, T0 + 31 * JOUR), false);
  assert.equal(brouillonValide({ etape: 1, releve: { hBuse: 1 } }, T0), true);
  assert.equal(brouillonValide({ etape: 0, releve: null }, T0), false);
  assert.equal(brouillonValide(null, T0), false);
  assert.equal(brouillonValide({ releve: {}, savedAt: 'pas une date' }, T0), false);
});

test('nouveauBrouillon porte version, date et champs modifiés', () => {
  const d = nouveauBrouillon({ etape: 1, criteres: { combustible: 'pellets' }, configurationId: 'c', configLibelle: 'L', releve: { a: 1 }, modifies: ['a'] }, T0);
  assert.equal(d.version, 1);
  assert.equal(d.savedAt, new Date(T0).toISOString());
  assert.deepEqual(d.modifies, ['a']);
});

test('clesModifiees et ajouterModifies', () => {
  assert.deepEqual(clesModifiees({ a: 1, b: 2 }, { a: 1, b: 3 }), ['b']);
  assert.deepEqual(clesModifiees(null, { a: 1 }), ['a']);
  assert.deepEqual(clesModifiees({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(ajouterModifies(['a'], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(ajouterModifies(undefined, ['a']), ['a']);
});

test('resumeBrouillon ne montre jamais de code de configuration', () => {
  assert.equal(resumeBrouillon({ configLibelle: 'Conduit isolé PTR30 neuf, à travers la maison', releve: { diametre: 150 } }), 'Conduit isolé PTR30 neuf, à travers la maison · Ø150');
  assert.equal(resumeBrouillon({ configurationId: 'CFG-27', releve: {} }), 'Relevé en cours');
  assert.doesNotMatch(resumeBrouillon({ configurationId: 'CFG-27', releve: { diametre: 80 } }), /CFG-/);
});

test('titreReprise : date et heure de Paris, ancien format sans date', () => {
  assert.equal(titreReprise({ savedAt: new Date(T0).toISOString() }), 'Reprendre le relevé du 28 nov. à 12:46 ?');
  assert.equal(titreReprise({}), 'Reprendre le relevé en cours ?');
});

test('contradictionFamille dit la contradiction en clair', () => {
  assert.equal(contradictionFamille({ criteres: { combustible: 'bois_buches' } }, { combustible: 'pellets' }), 'Ce relevé est prévu pour le bois bûches, le devis pour les granulés.');
  assert.equal(contradictionFamille({ criteres: { combustible: 'pellets' } }, { combustible: 'pellets' }), null);
  assert.equal(contradictionFamille({ criteres: {} }, { combustible: 'pellets' }), null);
  assert.equal(contradictionFamille({ criteres: { combustible: 'pellets' } }, {}), null);
});
