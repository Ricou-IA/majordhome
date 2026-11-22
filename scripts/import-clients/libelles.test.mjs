import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  libellesRapprochement, phraseBilan, texteRetrait, texteRetraitFait, messageEchecRetrait, resumeFichesImport, texteCorrections, texteArret,
  texteAccentsRepares, texteSansCodePostal,
} from '../../src/lib/importClients/libelles.js';

test('chaque raison de rapprochement a son libellé, dans l\'ordre reçu', () => {
  assert.deepEqual(
    libellesRapprochement({ matchReasons: ['phone', 'email', 'name', 'name_cp', 'nom_affiche'] }),
    ['même téléphone', 'même e-mail', 'même nom et prénom', 'même nom dans la même commune'],
  );
});

test('« même nom » omis quand « même nom et prénom » y est déjà, gardé sinon', () => {
  assert.deepEqual(libellesRapprochement({ matchReasons: ['name', 'nom_affiche'], raisonAncienNumero: true }), ['même nom et prénom', 'même ancien numéro']);
  assert.deepEqual(libellesRapprochement({ matchReasons: ['nom_affiche', 'name'] }), ['même nom et prénom']);
  assert.deepEqual(libellesRapprochement({ matchReasons: ['phone', 'nom_affiche'] }), ['même téléphone', 'même nom']);
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
    `${(2828).toLocaleString('fr-FR')} fiches seront retirées. 12 seront conservées : elles sont déjà utilisées ailleurs (contrat, intervention, devis, e-mail envoyé…).`,
  );
  assert.equal(
    texteRetrait({ retirables: 0, conservees: 12 }),
    'Aucune fiche ne peut être retirée : les 12 fiches de cet import sont déjà utilisées ailleurs (contrat, intervention, devis, e-mail envoyé…).',
  );
  assert.equal(texteRetrait({ retirables: 0, conservees: 0 }), 'Cet import ne contient aucune fiche. Le retirer de la liste ?');
});

test('texte du retrait : singuliers', () => {
  assert.equal(texteRetrait({ retirables: 1, conservees: 0 }), '1 fiche sera retirée.');
  assert.equal(
    texteRetrait({ retirables: 5, conservees: 1 }),
    '5 fiches seront retirées. 1 sera conservée : elle est déjà utilisée ailleurs (contrat, intervention, devis, e-mail envoyé…).',
  );
  assert.equal(
    texteRetrait({ retirables: 0, conservees: 1 }),
    'Aucune fiche ne peut être retirée : la fiche de cet import est déjà utilisée ailleurs (contrat, intervention, devis, e-mail envoyé…).',
  );
});

test('texte du toast de retrait', () => {
  assert.equal(texteRetraitFait({ retirees: 2828, conservees: 12 }), `${(2828).toLocaleString('fr-FR')} fiches retirées, 12 conservées`);
  assert.equal(texteRetraitFait({ retirees: 1, conservees: 1 }), '1 fiche retirée, 1 conservée');
  assert.equal(texteRetraitFait({ retirees: 3, conservees: 0 }), '3 fiches retirées');
  assert.equal(texteRetraitFait({ retirees: 0, conservees: 12 }), 'Aucune fiche retirée, 12 conservées');
  assert.equal(texteRetraitFait({ retirees: 0, conservees: 0 }), 'Import retiré de la liste.');
});

test("échec du retrait : le message est suivi de l'avertissement", () => {
  assert.equal(
    messageEchecRetrait('La base a refusé.'),
    "La base a refusé. Des fiches ont pu être retirées avant l'arrêt : relancez le retrait pour terminer.",
  );
});

test("ligne d'un import précédent : créées, puis retirées et conservées", () => {
  assert.equal(resumeFichesImport({ importees: 3000 }), `${(3000).toLocaleString('fr-FR')} fiches créées`);
  assert.equal(resumeFichesImport({ importees: 1 }), '1 fiche créée');
  assert.equal(resumeFichesImport({ lues: 10, prevues: 8 }), 'import interrompu');
  assert.equal(resumeFichesImport(null), 'import interrompu');
  assert.equal(resumeFichesImport({ importees: 30, retirees: 28, conservees: 2 }), '30 fiches créées · 28 retirées, 2 conservées');
  assert.equal(resumeFichesImport({ importees: 2, retirees: 1, conservees: 1 }), '2 fiches créées · 1 retirée, 1 conservée');
  assert.equal(resumeFichesImport({ importees: 30, retirees: 0, conservees: 30 }), '30 fiches créées');
  assert.equal(resumeFichesImport({ prevues: 8, retirees: 3, conservees: 0 }), 'import interrompu · 3 retirées');
});

test("valeurs illisibles : une phrase, la plus fréquente d'abord", () => {
  assert.equal(texteCorrections([]), null);
  assert.equal(
    texteCorrections([{ libelle: 'E-mail', nombre: 14 }, { libelle: 'Téléphone', nombre: 3 }]),
    "Valeurs illisibles : 14 × E-mail, 3 × Téléphone. Le champ est laissé vide et la valeur d'origine est gardée dans les notes internes de la fiche.",
  );
  assert.equal(
    texteCorrections([{ libelle: 'Accepte les SMS', nombre: 2 }]),
    "Valeurs illisibles : 2 × Accepte les SMS. Le champ est laissé vide (« oui » pour un accord) et la valeur d'origine est gardée dans les notes internes de la fiche.",
  );
  assert.equal(
    texteCorrections([{ libelle: 'Type de client', nombre: 1 }]),
    "Valeurs illisibles : 1 × Type de client. Le champ est laissé vide (« particulier » pour un type de client) et la valeur d'origine est gardée dans les notes internes de la fiche.",
  );
  assert.equal(
    texteCorrections([{ libelle: 'Type de client', nombre: 2 }, { libelle: 'Accepte les SMS', nombre: 1 }]),
    "Valeurs illisibles : 2 × Type de client, 1 × Accepte les SMS. Le champ est laissé vide (« oui » pour un accord, « particulier » pour un type de client) et la valeur d'origine est gardée dans les notes internes de la fiche.",
  );
});

test('accents réparés : rien à dire à zéro, singulier et pluriel', () => {
  assert.equal(texteAccentsRepares(0), null);
  assert.equal(texteAccentsRepares(undefined), null);
  assert.equal(texteAccentsRepares(1), 'Des accents abîmés ont été réparés dans 1 cellule (fichier passé par un tableur).');
  assert.equal(texteAccentsRepares(23), 'Des accents abîmés ont été réparés dans 23 cellules (fichier passé par un tableur).');
});

test('fiches sans code postal : rien à dire à zéro, singulier et pluriel', () => {
  assert.equal(texteSansCodePostal(0), null);
  assert.equal(texteSansCodePostal(1), '1 fiche sans code postal : elle ne sera pas placée sur la carte.');
  assert.equal(texteSansCodePostal(4), '4 fiches sans code postal : elles ne seront pas placées sur la carte.');
});

test("import arrêté : combien de fiches sont déjà créées, et où les retirer", () => {
  assert.equal(texteArret(0), "Import arrêté : aucune fiche n'a été créée.");
  assert.equal(texteArret(1), "Import arrêté : 1 fiche est déjà créée. Vous pouvez la retirer dans « Imports précédents », plus bas.");
  assert.equal(texteArret(400), "Import arrêté : 400 fiches sont déjà créées. Vous pouvez les retirer dans « Imports précédents », plus bas.");
});
