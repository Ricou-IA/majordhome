import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libellesRapprochement } from '../../src/lib/importClients/libelles.js';

test('chaque raison de rapprochement a son libellé, dans l\'ordre reçu', () => {
  assert.deepEqual(
    libellesRapprochement({ matchReasons: ['phone', 'email', 'name', 'name_cp', 'nom_affiche'] }),
    ['même téléphone', 'même e-mail', 'même nom et prénom', 'même nom dans la même commune', 'même nom'],
  );
});

test('ancien numéro ajouté en dernier', () => {
  assert.deepEqual(libellesRapprochement({ matchReasons: ['phone'], raisonAncienNumero: true }), ['même téléphone', 'même ancien numéro']);
  assert.deepEqual(libellesRapprochement({ matchReasons: [], raisonAncienNumero: true }), ['même ancien numéro']);
});

test('raison inconnue ignorée, doublon vide ou absent → rien', () => {
  assert.deepEqual(libellesRapprochement({ matchReasons: ['autre', 'email'] }), ['même e-mail']);
  assert.deepEqual(libellesRapprochement({}), []);
  assert.deepEqual(libellesRapprochement(null), []);
});

test('pas de libellé en double', () => {
  assert.deepEqual(libellesRapprochement({ matchReasons: ['email', 'email'] }), ['même e-mail']);
});
