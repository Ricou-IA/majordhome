// scripts/maintenance/vocabulaire.test.mjs — vocabulaire du module de tâches récurrentes
// node --test scripts/maintenance/vocabulaire.test.mjs   (dans npm run audit:quality)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabulaire, VOCABULAIRE_DEFAUT } from '../../src/lib/maintenance/vocabulaire.js';

test('défauts quand rien n’est réglé', () => {
  assert.deepEqual(vocabulaire({}), VOCABULAIRE_DEFAUT);
  assert.deepEqual(vocabulaire(null), { module: 'Maintenance', unite: 'Unité', unites: 'Unités' });
});

test('valeurs de l’org, espaces retirés, champ vide ⇒ défaut', () => {
  const v = vocabulaire({ maintenance: { vocabulaire: { module: '  Traçabilité ', unite: 'Zone', unites: '' } } });
  assert.deepEqual(v, { module: 'Traçabilité', unite: 'Zone', unites: 'Zones' });
});

test('pluriel déduit du singulier quand il manque : + s, sauf finale s / x / z (cas composés : champ pluriel)', () => {
  assert.equal(vocabulaire({ maintenance: { vocabulaire: { unite: 'Quai' } } }).unites, 'Quais');
  assert.equal(vocabulaire({ maintenance: { vocabulaire: { unite: 'Box' } } }).unites, 'Box');
  assert.equal(vocabulaire({ maintenance: { vocabulaire: { unite: 'Local technique', unites: 'Locaux techniques' } } }).unites, 'Locaux techniques');
});

test('une valeur non textuelle est ignorée', () => {
  assert.deepEqual(vocabulaire({ maintenance: { vocabulaire: { module: 42, unite: null } } }), VOCABULAIRE_DEFAUT);
});
