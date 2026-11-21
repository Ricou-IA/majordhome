import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libellesRapprochement, phraseBilan } from '../../src/lib/importClients/libelles.js';

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

test('phrase du bilan : une seule chaîne, singulier et pluriel, zéros compris', () => {
  assert.equal(phraseBilan({ lues: 1, importees: 1, doublons_ecartes: 0, ecartees: 0 }), '1 ligne lue = 1 à importer + 0 doublon écarté + 0 écartée');
  assert.equal(phraseBilan({ lues: 10, importees: 7, doublons_ecartes: 1, ecartees: 2 }), '10 lignes lues = 7 à importer + 1 doublon écarté + 2 écartées');
  assert.equal(phraseBilan({ lues: 12, importees: 5, doublons_ecartes: 4, ecartees: 3 }), '12 lignes lues = 5 à importer + 4 doublons écartés + 3 écartées');
});
