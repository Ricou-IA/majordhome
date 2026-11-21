import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feuillesFichierType, feuilleLignesEcartees } from '../../src/lib/importClients/fichierType.js';
import { CHAMPS } from '../../src/lib/importClients/champs.js';
import { estFichierType } from '../../src/lib/importClients/correspondance.js';
import { classerLignes } from '../../src/lib/importClients/controles.js';

test('le fichier type se réimporte sans rien pointer', () => {
  const [clients, aide] = feuillesFichierType();
  assert.equal(clients.nom, 'Clients');
  assert.equal(aide.nom, "Mode d'emploi");
  assert.equal(clients.lignes.length, 1); // l'en-tête seule : aucune ligne d'exemple
  assert.ok(estFichierType(clients.lignes[0]));
  assert.equal(aide.lignes.length, CHAMPS.length + 1);
  assert.deepEqual(aide.lignes[0], ['Colonne', 'À quoi elle sert', 'Exemple', 'Valeurs admises']);
});

test('mode d\'emploi : valeurs admises pour les listes, vide sinon', () => {
  const [, aide] = feuillesFichierType();
  const type = aide.lignes.find((l) => l[0] === 'Type de client');
  assert.equal(type[3], 'particulier, entreprise, public');
  const nom = aide.lignes.find((l) => l[0] === 'Nom');
  assert.equal(nom[3], '');
  assert.equal(aide.lignes.find((l) => l[0] === 'Accepte les e-mails')[3], 'oui, non');
  assert.equal(aide.lignes.find((l) => l[0] === 'Accepte les SMS')[3], 'oui, non');
});

test('lignes écartées : colonnes d\'origine et raison', () => {
  const classees = classerLignes([{ numero: 2, valeurs: { email: 'a@b.fr' }, notesAjoutees: [] }], []);
  const f = feuilleLignesEcartees(['Mail'], [{ numero: 2, cellules: ['a@b.fr'] }], classees, { importer: new Set(), ecarter: new Set() });
  assert.equal(f.nom, 'Lignes écartées');
  assert.deepEqual(f.lignes, [['Mail', 'Raison'], ['a@b.fr', 'Ni nom ni société']]);
});

test('lignes écartées : un doublon repris n\'y figure pas, un doublon du fichier non repris oui', () => {
  const candidates = [
    { numero: 2, valeurs: { nom: 'Martin', email: 'x@y.fr' }, notesAjoutees: [] },
    { numero: 3, valeurs: { nom: 'Martin', email: 'x@y.fr' }, notesAjoutees: [] },
  ];
  const classees = classerLignes(candidates, []);
  assert.equal(classees[1].statut, 'doublon_fichier');
  const lignes = [{ numero: 2, cellules: ['Martin', 'x@y.fr'] }, { numero: 3, cellules: ['Martin', 'x@y.fr'] }];
  const sans = feuilleLignesEcartees(['Nom', 'Mail'], lignes, classees, { importer: new Set(), ecarter: new Set() });
  assert.deepEqual(sans.lignes, [['Nom', 'Mail', 'Raison'], ['Martin', 'x@y.fr', 'Déjà présent plus haut dans le fichier']]);
  const avec = feuilleLignesEcartees(['Nom', 'Mail'], lignes, classees, { importer: new Set([3]), ecarter: new Set() });
  assert.deepEqual(avec.lignes, [['Nom', 'Mail', 'Raison']]);
});
