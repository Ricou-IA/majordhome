import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGNES_MAX, OCTETS_MAX, refusFichier, decoderTexte, lireCsv, celluleEnTexte, trouverEntete, tableau,
} from '../../src/lib/importClients/lireFichier.js';

test('limites', () => {
  assert.equal(LIGNES_MAX, 10000);
  assert.equal(OCTETS_MAX, 10 * 1024 * 1024);
});
test('refus : .xls, trop lourd', () => {
  assert.equal(refusFichier({ nom: 'clients.xls', taille: 1000 }), 'Ancien format Excel (.xls) : enregistrez-le en .xlsx ou .csv, puis déposez-le.');
  assert.equal(refusFichier({ nom: 'c.xlsx', taille: OCTETS_MAX + 1 }), 'Fichier trop lourd (10 Mo au plus).');
  assert.equal(refusFichier({ nom: 'c.pdf', taille: 10 }), 'Format non pris en charge : déposez un fichier .xlsx ou .csv.');
  assert.equal(refusFichier({ nom: 'Clients.CSV', taille: 10 }), null);
});
test('refus : le format passe avant la taille, la taille pile est acceptée', () => {
  assert.equal(refusFichier({ nom: 'c.pdf', taille: OCTETS_MAX + 1 }), 'Format non pris en charge : déposez un fichier .xlsx ou .csv.');
  assert.equal(refusFichier({ nom: 'C.XLSX', taille: OCTETS_MAX }), null);
  assert.equal(refusFichier({ nom: 'sans-extension', taille: 1 }), 'Format non pris en charge : déposez un fichier .xlsx ou .csv.');
});
test('Windows-1252 : Élodie reste Élodie', () => {
  const octets = Uint8Array.from([0xC9, 0x6C, 0x6F, 0x64, 0x69, 0x65]);
  assert.equal(decoderTexte(octets), 'Élodie');
});
test('UTF-8 avec BOM', () => assert.equal(decoderTexte(Uint8Array.from([0xEF, 0xBB, 0xBF, 0x41])), 'A'));
test('UTF-8 sans BOM', () => assert.equal(decoderTexte(new TextEncoder().encode('Léa')), 'Léa'));
test('CSV : point-virgule, guillemets, retour à la ligne dans une cellule', () => {
  assert.deepEqual(lireCsv('Nom;Adresse\r\n"DUPONT";"12 rue ""des Lilas""\nBât. B"\r\n'), [['Nom', 'Adresse'], ['DUPONT', '12 rue "des Lilas"\nBât. B']]);
});
test('CSV : virgule détectée', () => assert.deepEqual(lireCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]));
test('CSV : tabulation détectée', () => assert.deepEqual(lireCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]));
test('CSV : séparateur entre guillemets ignoré à la détection', () => {
  assert.deepEqual(lireCsv('"a,b,c";d\n1;2'), [['a,b,c', 'd'], ['1', '2']]);
});
test('CSV : fins de ligne \n et \r, ligne vide finale sans ligne, longueurs variables', () => {
  assert.deepEqual(lireCsv('a;b\rc;d;e\n'), [['a', 'b'], ['c', 'd', 'e']]);
  assert.deepEqual(lireCsv('a;b\n\n'), [['a', 'b']]);
  assert.deepEqual(lireCsv(''), []);
});
test('cellules ExcelJS', () => {
  assert.equal(celluleEnTexte(612345678), '612345678');
  assert.equal(celluleEnTexte({ formula: 'A1', result: 'Jean' }), 'Jean');
  assert.equal(celluleEnTexte({ richText: [{ text: 'DU' }, { text: 'PONT' }] }), 'DUPONT');
  assert.equal(celluleEnTexte(new Date(Date.UTC(2024, 2, 5))), '2024-03-05');
  assert.equal(celluleEnTexte(null), '');
});
test('cellules : liens, formules à résultat Date ou nombre, erreurs, booléens, chaînes', () => {
  assert.equal(celluleEnTexte({ text: 'x@y.fr', hyperlink: 'mailto:x@y.fr' }), 'x@y.fr');
  assert.equal(celluleEnTexte({ formula: 'B1', result: new Date(Date.UTC(2024, 11, 31)) }), '2024-12-31');
  assert.equal(celluleEnTexte({ formula: 'B1', result: 85.5 }), '85.5');
  assert.equal(celluleEnTexte({ error: '#N/A' }), '');
  assert.equal(celluleEnTexte(true), 'true');
  assert.equal(celluleEnTexte(false), 'false');
  assert.equal(celluleEnTexte('  Jean '), 'Jean');
  assert.equal(celluleEnTexte(undefined), '');
});
test('cellules : nombres sans notation scientifique', () => {
  assert.equal(celluleEnTexte(33612345678), '33612345678');
  assert.equal(celluleEnTexte(8.16e10), '81600000000');
  assert.equal(celluleEnTexte(1e21), '1000000000000000000000');
  assert.equal(celluleEnTexte(85.5), '85.5');
  assert.equal(celluleEnTexte(0.0000001), '0.0000001');
  assert.equal(celluleEnTexte(NaN), '');
});
test('titre au-dessus de l\'en-tête, lignes vides ignorées, numéros du fichier gardés', () => {
  const m = [['Export clients du 12/11'], [], ['Nom', 'Prénom', 'Tél'], ['DUPONT', 'Jean', '06'], ['', '', ''], ['MARTIN', 'Léa', '']];
  assert.equal(trouverEntete(m), 2);
  const t = tableau(m, 2);
  assert.deepEqual(t.entetes, ['Nom', 'Prénom', 'Tél']);
  assert.deepEqual(t.lignes.map((l) => l.numero), [4, 6]);
});
test('colonne sans en-tête', () => assert.deepEqual(tableau([['Nom', '', 'Ville'], ['A', 'B', 'C']], 0).entetes, ['Nom', 'Colonne B', 'Ville']));
test('en-tête : égalité = première ligne ; au-delà de dix lignes ignoré', () => {
  assert.equal(trouverEntete([['a', 'b'], ['c', 'd']]), 0);
  const m = Array.from({ length: 10 }, () => ['x']);
  m.push(['a', 'b', 'c']);
  assert.equal(trouverEntete(m), 0);
});
test('tableau : cellules complétées ou coupées, textes d\'en-tête rognés, lettres au-delà de Z', () => {
  const t = tableau([[' Nom ', 'Ville'], ['A'], ['B', 'C', 'D'], ['  ', '']], 0);
  assert.deepEqual(t.entetes, ['Nom', 'Ville']);
  assert.deepEqual(t.lignes, [{ numero: 2, cellules: ['A', ''] }, { numero: 3, cellules: ['B', 'C'] }]);
  const large = tableau([[...Array(28).fill('x').map((v, i) => (i < 26 ? v : ''))]], 0);
  assert.deepEqual(large.entetes.slice(26), ['Colonne AA', 'Colonne AB']);
});
test('CSV à virgule précédé d\'un titre sans séparateur : lu de bout en bout', () => {
  const m = lireCsv('Export clients du 12/11\nNom,Prénom\nDUPONT,Jean\nMARTIN,Léa\n');
  const i = trouverEntete(m);
  assert.equal(i, 1);
  const t = tableau(m, i);
  assert.deepEqual(t.entetes, ['Nom', 'Prénom']);
  assert.deepEqual(t.lignes, [{ numero: 3, cellules: ['DUPONT', 'Jean'] }, { numero: 4, cellules: ['MARTIN', 'Léa'] }]);
});
test('CSV à tabulation précédé d\'un titre', () => {
  assert.deepEqual(lireCsv('Titre\na\tb\n1\t2'), [['Titre'], ['a', 'b'], ['1', '2']]);
});
test('titre avec une virgule au-dessus de données en point-virgule : le point-virgule gagne', () => {
  assert.deepEqual(lireCsv('Export clients, du 12/11\nNom;Ville\nA;B\nC;D'), [['Export clients, du 12/11'], ['Nom', 'Ville'], ['A', 'B'], ['C', 'D']]);
});
test('guillemet au milieu d\'une cellule non quotée : gardé tel quel', () => {
  assert.deepEqual(lireCsv('Nom;Note\nDUPONT;tube 5" inox\nMARTIN;Jean "Jo"'), [['Nom', 'Note'], ['DUPONT', 'tube 5" inox'], ['MARTIN', 'Jean "Jo"']]);
});
test('ligne vide au milieu : gardée par lireCsv, retirée par tableau, numéros fidèles', () => {
  const m = lireCsv('Nom;Ville\nA;B\n\nC;D\n');
  assert.deepEqual(m, [['Nom', 'Ville'], ['A', 'B'], [''], ['C', 'D']]);
  assert.deepEqual(tableau(m, 0).lignes.map((l) => l.numero), [2, 4]);
});
test('guillemet ouvrant jamais fermé : pas de plantage', () => {
  assert.deepEqual(lireCsv('a;b\n"c;d\ne;f'), [['a', 'b'], ['c;d\ne;f']]);
});
test('fin de ligne a;b; : cellule vide finale présente', () => {
  assert.deepEqual(lireCsv('a;b;\n1;2;'), [['a', 'b', ''], ['1', '2', '']]);
});
