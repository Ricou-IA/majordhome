import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPS, CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR } from '../../src/lib/importClients/champs.js';
import {
  estFichierType, proposerCorrespondance, validerCorrespondance, appliquerCorrespondance, decouper,
} from '../../src/lib/importClients/correspondance.js';

test('fichier type reconnu', () => {
  const c = proposerCorrespondance(CHAMPS.map((x) => x.libelle));
  assert.ok(c.every((x) => x.origine === 'fichier_type' && x.cible));
});
test('synonymes, puis à choisir', () => {
  const c = proposerCorrespondance(['NOM', 'Tél. portable', 'Code agence', 'Portable']);
  assert.deepEqual(c.map((x) => x.cible), ['nom', 'telephone', '', '']); // « Portable » : téléphone déjà pris
  assert.equal(validerCorrespondance(c).aChoisir, 2);
});
test('index, en-tête et origine d\'une proposition', () => {
  const c = proposerCorrespondance(['NOM', 'Code agence', 'Portable', 'Tél']);
  assert.deepEqual(c.map((x) => x.index), [0, 1, 2, 3]);
  assert.deepEqual(c.map((x) => x.entete), ['NOM', 'Code agence', 'Portable', 'Tél']);
  assert.deepEqual(c.map((x) => x.origine), ['synonyme', '', 'synonyme', '']);
});
test('estFichierType : liste vide ou sans en-tête non vide', () => {
  assert.equal(estFichierType([]), false);
  assert.equal(estFichierType(['', '  ']), false);
  assert.equal(estFichierType(['Nom', '', 'Prénom']), true);
  assert.equal(estFichierType(['Nom', 'Tél']), false);
});
test('validation', () => {
  const base = [{ index: 0, entete: 'A', cible: 'telephone', origine: 'main' }, { index: 1, entete: 'B', cible: 'telephone', origine: 'main' }];
  assert.deepEqual(validerCorrespondance(base).erreurs, ['Deux colonnes vont vers « Téléphone » : gardez-en une.', 'Indiquez la colonne du nom ou de la société.']);
});
test('validation : cible composée comptée pour chaque champ, notes et ignorées sans limite', () => {
  const c = [
    { index: 0, entete: 'A', cible: '@nom_prenom' }, { index: 1, entete: 'B', cible: 'prenom' },
    { index: 2, entete: 'C', cible: CIBLE_NOTES }, { index: 3, entete: 'D', cible: CIBLE_NOTES },
    { index: 4, entete: 'E', cible: CIBLE_IGNORER }, { index: 5, entete: 'F', cible: CIBLE_IGNORER },
  ];
  assert.deepEqual(validerCorrespondance(c), { erreurs: ['Deux colonnes vont vers « Prénom » : gardez-en une.'], aChoisir: 0 });
  assert.deepEqual(validerCorrespondance([{ index: 0, entete: 'A', cible: 'societe' }]), { erreurs: [], aChoisir: 0 });
});
test('découpes', () => {
  assert.deepEqual(decouper('@nom_prenom', 'DE LA FONTAINE Jean-Pierre'), { nom: 'DE LA FONTAINE', prenom: 'Jean-Pierre' });
  assert.deepEqual(decouper('@nom_prenom', 'Dupont Jean'), { nom: 'Dupont', prenom: 'Jean' });
  assert.deepEqual(decouper('@prenom_nom', 'Jean Dupont'), { prenom: 'Jean', nom: 'Dupont' });
  assert.deepEqual(decouper('@cp_ville', '81600 Gaillac'), { code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@adresse_complete', '12 rue des Lilas 81600 Gaillac'), { adresse: '12 rue des Lilas', code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@adresse_complete', 'Lieu-dit Le Bosc'), { adresse: 'Lieu-dit Le Bosc', code_postal: '', ville: '' });
});
test('nom et prénom tout en majuscules : le dernier mot est le prénom', () => {
  assert.deepEqual(decouper('@nom_prenom', 'DUPONT JEAN'), { nom: 'DUPONT', prenom: 'JEAN' });
  assert.deepEqual(decouper('@nom_prenom', 'DE LA FONTAINE JEAN-PIERRE'), { nom: 'DE LA FONTAINE', prenom: 'JEAN-PIERRE' });
  assert.deepEqual(decouper('@nom_prenom', 'DUPONT'), { nom: 'DUPONT', prenom: '' });
  assert.deepEqual(decouper('@nom_prenom', 'MARTIN ÉLODIE'), { nom: 'MARTIN', prenom: 'ÉLODIE' });
  assert.deepEqual(decouper('@nom_prenom', 'DE LA FONTAINE Jean-Pierre'), { nom: 'DE LA FONTAINE', prenom: 'Jean-Pierre' });
  assert.deepEqual(decouper('@nom_prenom', 'Dupont Jean'), { nom: 'Dupont', prenom: 'Jean' });
});
test('@cp_ville : rien n est jeté', () => {
  assert.deepEqual(decouper('@cp_ville', 'Gaillac 81600'), { code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@cp_ville', '81600 Gaillac'), { code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@cp_ville', 'F 81600 Gaillac'), { code_postal: '81600', ville: 'F Gaillac' });
  assert.deepEqual(decouper('@cp_ville', 'Gaillac'), { code_postal: '', ville: 'Gaillac' });
});
test('civilités retirées avant la découpe', () => {
  assert.deepEqual(decouper('@nom_prenom', 'Mme DUPONT Jean'), { nom: 'DUPONT', prenom: 'Jean' });
  assert.deepEqual(decouper('@nom_prenom', 'M. DUPONT Jean'), { nom: 'DUPONT', prenom: 'Jean' });
  assert.deepEqual(decouper('@nom_prenom', 'M DUPONT Jean'), { nom: 'DUPONT', prenom: 'Jean' });
  assert.deepEqual(decouper('@nom_prenom', 'M. et Mme DUPONT JEAN'), { nom: 'DUPONT', prenom: 'JEAN' });
  assert.deepEqual(decouper('@nom_prenom', 'Mr & Mme DUPONT Jean'), { nom: 'DUPONT', prenom: 'Jean' });
  assert.deepEqual(decouper('@nom_prenom', 'Monsieur et Madame DUPONT Jean'), { nom: 'DUPONT', prenom: 'Jean' });
  assert.deepEqual(decouper('@prenom_nom', 'Madame Jeanne Martin'), { prenom: 'Jeanne', nom: 'Martin' });
  assert.deepEqual(decouper('@nom_prenom', 'MARTIN Marie'), { nom: 'MARTIN', prenom: 'Marie' });
  assert.deepEqual(decouper('@nom_prenom', 'M Dupont'), { nom: 'M', prenom: 'Dupont' });
  assert.deepEqual(decouper('@nom_prenom', 'Mme'), { nom: 'Mme', prenom: '' });
});
test('espaces multiples dans un nom', () => {
  assert.deepEqual(decouper('@nom_prenom', 'DUPONT   Jean'), { nom: 'DUPONT', prenom: 'Jean' });
});
test('en-tête vide ou d espaces : colonne ignorée', () => {
  const c = proposerCorrespondance(['Nom', '', '   ']);
  assert.deepEqual(c.map((x) => x.cible), ['nom', CIBLE_IGNORER, CIBLE_IGNORER]);
  assert.deepEqual(c.map((x) => x.origine), ['fichier_type', '', '']);
});
test('application : notes ajoutées, colonnes ignorées', () => {
  const c = [{ index: 0, entete: 'Client', cible: '@nom_prenom' }, { index: 1, entete: 'Marque chaudière', cible: '@notes' }, { index: 2, entete: 'Agence', cible: '@ignorer' }];
  assert.deepEqual(appliquerCorrespondance({ numero: 7, cellules: ['DUPONT Jean', 'Viessmann', 'Albi'] }, c),
    { numero: 7, valeurs: { nom: 'DUPONT', prenom: 'Jean' }, notesAjoutees: ['Marque chaudière : Viessmann'] });
});
test('application : cellule vide sans clé, à choisir ignorée, premier non vide gagne', () => {
  const c = [
    { index: 0, entete: 'A', cible: 'telephone' }, { index: 1, entete: 'B', cible: 'telephone' },
    { index: 2, entete: 'C', cible: 'email' }, { index: 3, entete: 'D', cible: CIBLE_A_CHOISIR },
    { index: 4, entete: 'E', cible: CIBLE_NOTES },
  ];
  assert.deepEqual(appliquerCorrespondance({ numero: 2, cellules: ['', ' 0612345678 ', '  ', 'x', ''] }, c),
    { numero: 2, valeurs: { telephone: '0612345678' }, notesAjoutees: [] });
  assert.deepEqual(appliquerCorrespondance({ numero: 3, cellules: ['0611', '0622', 'a@b.fr', 'x', 'n'] }, c).valeurs,
    { telephone: '0611', email: 'a@b.fr' });
});
