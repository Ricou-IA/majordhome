import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPS, CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR } from '../../src/lib/importClients/champs.js';
import {
  estFichierType, proposerCorrespondance, validerCorrespondance, appliquerCorrespondance, decouper, conseilsCorrespondance,
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

const lignesDe = (...colonnes) => colonnes[0].map((_, i) => ({ numero: i + 2, cellules: colonnes.map((col) => col[i]) }));

test('cible composée proposée par l\'en-tête : elle prend tous ses champs', () => {
  assert.deepEqual(proposerCorrespondance(['Nom complet', 'Adresse complète', 'Mail']).map((x) => x.cible), ['@nom_prenom', '@adresse_complete', 'email']);
  // Une colonne suivante ne prend pas un champ qu'elle tient…
  assert.deepEqual(proposerCorrespondance(['Adresse complète', 'CP', 'Ville']).map((x) => x.cible), ['@adresse_complete', '', '']);
  // … et elle n'est pas proposée si l'un de ses champs est déjà pris.
  assert.deepEqual(proposerCorrespondance(['CP', 'Adresse complète']).map((x) => x.cible), ['code_postal', '']);
  assert.deepEqual(proposerCorrespondance(['Prénom', 'Nom complet']).map((x) => x.cible), ['prenom', '']);
  assert.deepEqual(proposerCorrespondance(['CP Ville', 'Adresse complète']).map((x) => x.cible), ['@cp_ville', '']);
  assert.equal(proposerCorrespondance(['Nom complet'])[0].origine, 'synonyme');
});

test('fichier d\'essai de la recette : seules deux colonnes restent à choisir', () => {
  const entetes = ['Réf. client', 'Nom complet', 'Société', 'GSM', 'Mail', 'Adresse complète', 'Type de logement', 'Surface habitable', 'Marque chaudière', 'Accord SMS', 'ID interne'];
  assert.deepEqual(proposerCorrespondance(entetes).map((x) => x.cible), [
    'ancien_numero', '@nom_prenom', 'societe', 'telephone', 'email', '@adresse_complete', 'type_logement', 'surface', '', 'accepte_sms', '',
  ]);
});

test('nom et prénom : l\'ordre se lit sur les valeurs quand elles sont données', () => {
  const entetes = ['Client', 'Ville'];
  const prenomNom = lignesDe(['Jean DUPONT', 'Mme Claire MARTIN', 'DURAND Paul', '', 'Léa ROUX'], ['Lyon', 'Lyon', 'Lyon', 'Lyon', 'Lyon']);
  assert.equal(proposerCorrespondance(entetes, prenomNom)[0].cible, '@prenom_nom');
  assert.equal(proposerCorrespondance(entetes)[0].cible, '@nom_prenom');
  const nomPrenom = lignesDe(['DUPONT Jean', 'Mme MARTIN Claire', 'Paul DURAND', 'LEROY JEAN'], ['', '', '', '']);
  assert.equal(proposerCorrespondance(entetes, nomPrenom)[0].cible, '@nom_prenom');
  // À égalité : nom puis prénom.
  assert.equal(proposerCorrespondance(entetes, lignesDe(['DUPONT Jean', 'Paul DURAND'], ['', '']))[0].cible, '@nom_prenom');
  // Un en-tête simple n'est pas touché par les valeurs.
  assert.equal(proposerCorrespondance(['Nom'], lignesDe(['Jean DUPONT']))[0].cible, 'nom');
});

test('conseil : une colonne « Adresse » qui porte code postal et ville', () => {
  const c = [{ index: 0, entete: 'Nom', cible: 'nom' }, { index: 1, entete: 'Adresse complète', cible: 'adresse' }];
  const lignes = lignesDe(['A', 'B', 'C'], ['12 rue de la République 69003 Lyon', 'Lieu-dit Les Granges', '3 place Bellecour, 69002 Lyon']);
  assert.deepEqual(conseilsCorrespondance(c, lignes), [{ index: 1, message: 'Ces adresses contiennent le code postal et la ville.', cible: '@adresse_complete' }]);
  // Moins de la moitié des valeurs : pas de conseil.
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['A', 'B', 'C'], ['12 rue X 69003 Lyon', 'Lieu-dit', 'Le Bourg'])), []);
  // Une colonne va déjà vers le code postal (directement ou par une cible composée) : pas de conseil.
  const avec = (cible, valeur) => conseilsCorrespondance([...c, { index: 2, entete: 'X', cible }], lignes.map((l) => ({ ...l, cellules: [...l.cellules, valeur] })));
  assert.deepEqual(avec('code_postal', '69003'), []);
  assert.deepEqual(avec('@cp_ville', '69003 Lyon'), []);
  // Code postal en fin de texte, sans rien derrière : pas un code postal suivi de texte.
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['A', 'B'], ['12 rue X 69003', 'Rue Y 69002'])), []);
});

test('conseil : une colonne « Nom » qui porte nom et prénom', () => {
  const c = [{ index: 0, entete: 'Nom complet', cible: 'nom' }];
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['DURAND Paul', 'Mme MARTIN Claire', 'GARAGE'])),
    [{ index: 0, message: 'Ces valeurs contiennent le nom et le prénom.', cible: '@nom_prenom' }]);
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['Paul DURAND', 'Claire MARTIN'])),
    [{ index: 0, message: 'Ces valeurs contiennent le nom et le prénom.', cible: '@prenom_nom' }]);
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['DURAND', 'MARTIN', 'GARAGE'])), []);
  assert.deepEqual(conseilsCorrespondance([...c, { index: 1, entete: 'Prénom', cible: 'prenom' }], lignesDe(['DURAND Paul', 'MARTIN Claire'], ['Paul', 'Claire'])), []);
  assert.deepEqual(conseilsCorrespondance([...c, { index: 1, entete: 'P', cible: '@prenom_nom' }], lignesDe(['DURAND Paul', 'MARTIN Claire'], ['', ''])), []);
  // Colonne vide : rien à conseiller.
  assert.deepEqual(conseilsCorrespondance(c, lignesDe(['', ''])), []);
});

test('conseil : ne regarde que les 50 premières valeurs non vides', () => {
  const valeurs = ['', ...Array(50).fill('DURAND'), ...Array(200).fill('DURAND Paul')];
  assert.deepEqual(conseilsCorrespondance([{ index: 0, entete: 'Nom', cible: 'nom' }], lignesDe(valeurs)), []);
});
