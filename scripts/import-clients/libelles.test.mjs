import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libellesRapprochement, phraseBilan, texteRetrait, texteRetraitFait } from '../../src/lib/importClients/libelles.js';

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

test('texte du retrait : retirables seules, retirables et conservées, conservées seules, rien', () => {
  assert.equal(texteRetrait({ retirables: 2828, conservees: 0 }), `${(2828).toLocaleString('fr-FR')} fiches seront retirées.`);
  assert.equal(
    texteRetrait({ retirables: 2828, conservees: 12 }),
    `${(2828).toLocaleString('fr-FR')} fiches seront retirées. 12 seront conservées : elles ont déjà un contrat, une intervention ou un e-mail envoyé.`,
  );
  assert.equal(
    texteRetrait({ retirables: 0, conservees: 12 }),
    'Aucune fiche ne peut être retirée : les 12 fiches de cet import ont déjà un contrat, une intervention ou un e-mail envoyé.',
  );
  assert.equal(texteRetrait({ retirables: 0, conservees: 0 }), 'Cet import ne contient plus aucune fiche.');
});

test('texte du retrait : singuliers', () => {
  assert.equal(texteRetrait({ retirables: 1, conservees: 0 }), '1 fiche sera retirée.');
  assert.equal(
    texteRetrait({ retirables: 5, conservees: 1 }),
    '5 fiches seront retirées. 1 sera conservée : elle a déjà un contrat, une intervention ou un e-mail envoyé.',
  );
  assert.equal(
    texteRetrait({ retirables: 0, conservees: 1 }),
    'Aucune fiche ne peut être retirée : la fiche de cet import a déjà un contrat, une intervention ou un e-mail envoyé.',
  );
});

test('texte du toast de retrait', () => {
  assert.equal(texteRetraitFait({ retirees: 2828, conservees: 12 }), `${(2828).toLocaleString('fr-FR')} fiches retirées, 12 conservées`);
  assert.equal(texteRetraitFait({ retirees: 1, conservees: 1 }), '1 fiche retirée, 1 conservée');
  assert.equal(texteRetraitFait({ retirees: 3, conservees: 0 }), '3 fiches retirées');
  assert.equal(texteRetraitFait({ retirees: 0, conservees: 12 }), 'Aucune fiche retirée, 12 conservées');
  assert.equal(texteRetraitFait({ retirees: 0, conservees: 0 }), 'Aucune fiche retirée');
});
