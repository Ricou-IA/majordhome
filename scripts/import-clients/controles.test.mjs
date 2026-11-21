import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  controlerFiche, classerLignes, aImporter, bilan, lignesPourEcriture, LIBELLE_RAISON,
} from '../../src/lib/importClients/controles.js';
import { CHAMPS } from '../../src/lib/importClients/champs.js';

const cand = (numero, valeurs, notesAjoutees = []) => ({ numero, valeurs, notesAjoutees });
const aucun = () => ({ importer: new Set(), ecarter: new Set() });

test('ni nom ni société : écartée', () => {
  const r = controlerFiche(cand(2, { email: 'a@b.fr' }));
  assert.equal(r.ecartee, true); assert.equal(r.raison, 'sans_nom');
});
test('société sans type : entreprise, affichée sous sa raison sociale', () => {
  const { fiche } = controlerFiche(cand(2, { societe: 'Garage Durand', nom: 'Durand', prenom: 'Paul' }));
  assert.equal(fiche.client_category, 'entreprise');
  assert.equal(fiche.display_name, 'GARAGE DURAND');
  assert.equal(fiche.last_name, 'DURAND'); assert.equal(fiche.first_name, 'PAUL');
  assert.equal(fiche.company_name, 'Garage Durand');
});
test('valeur illisible : champ vide, valeur gardée en notes internes, ligne importable', () => {
  const r = controlerFiche(cand(3, { nom: 'Martin', email: 'martin(at)free', notes_internes: 'Chien' }, ['Marque : Atlantic']));
  assert.equal(r.ecartee, false);
  assert.equal(r.fiche.email, null);
  assert.equal(r.fiche.internal_notes, 'Chien\nMarque : Atlantic\nE-mail d\'origine : martin(at)free');
  assert.equal(r.fiche.notes, null);
  assert.deepEqual(r.corrections, [{ libelle: 'E-mail', valeur: 'martin(at)free' }]);
});
test('accord e-mails et SMS : oui d\'office', () => {
  const { fiche } = controlerFiche(cand(2, { nom: 'A', accepte_sms: 'non' }));
  assert.equal(fiche.mail_optin, true); assert.equal(fiche.sms_optin, false);
});
test('oui / non non reconnu : accord d\'office et correction notée', () => {
  const r = controlerFiche(cand(2, { nom: 'A', accepte_emails: 'peut-être' }));
  assert.equal(r.fiche.mail_optin, true);
  assert.deepEqual(r.corrections, [{ libelle: 'Accepte les e-mails', valeur: 'peut-être' }]);
  assert.match(r.fiche.internal_notes, /Accepte les e-mails d'origine : peut-être/);
});
test('téléphone illisible : vide, valeur gardée en notes internes', () => {
  const r = controlerFiche(cand(2, { nom: 'A', telephone: '0612 poste 12' }));
  assert.equal(r.fiche.phone, null);
  assert.equal(r.fiche.internal_notes, 'Téléphone d\'origine : 0612 poste 12');
});
test('une clé par colonne du catalogue, plus display_name ; sans note : null', () => {
  const { fiche } = controlerFiche(cand(2, { nom: 'A' }));
  for (const c of CHAMPS) assert.ok(c.colonne in fiche, c.colonne);
  assert.equal(Object.keys(fiche).length, CHAMPS.length + 1);
  assert.equal(fiche.internal_notes, null); assert.equal(fiche.phone, null);
  assert.equal(fiche.client_category, 'particulier');
});
test('ancien numéro rogné, nom en majuscules', () => {
  const { fiche } = controlerFiche(cand(2, { nom: 'dupont', ancien_numero: '  c-1 ' }));
  assert.equal(fiche.external_ref, 'c-1'); assert.equal(fiche.last_name, 'DUPONT');
});

const existants = [
  { id: 'c1', first_name: 'JEAN', last_name: 'DUPONT', phone: '06 12 34 56 78', email: null, postal_code: '81600', external_ref: null },
  { id: 'c2', first_name: 'LEA', last_name: 'MARTIN', phone: null, email: null, postal_code: '81000', external_ref: 'A-204' },
  { id: 'c3', first_name: 'PAUL', last_name: 'ROUX', phone: null, email: null, postal_code: '31000', external_ref: null },
];
const classe = (valeurs) => classerLignes([cand(2, valeurs)], existants)[0].statut;
test('doublons avec la base', () => {
  assert.equal(classe({ nom: 'Dupond', telephone: '612345678' }), 'doublon_fort');              // même téléphone
  assert.equal(classe({ nom: 'Autre', ancien_numero: 'a-204' }), 'doublon_fort');                // même ancien numéro
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul', code_postal: '31000' }), 'doublon_fort');   // même nom + prénom, même code postal
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul' }), 'doublon_fort');                         // même nom + prénom, code postal absent du fichier
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul', code_postal: '75001' }), 'doublon_faible'); // homonyme ailleurs
  assert.equal(classe({ nom: 'Roux', prenom: 'Anne', code_postal: '31000' }), 'doublon_faible'); // même nom, même commune
  assert.equal(classe({ nom: 'Nouveau', prenom: 'Client' }), 'prete');
});
test('doublon : raison, doublons et ancien numéro signalé', () => {
  const [l] = classerLignes([cand(2, { nom: 'Autre', ancien_numero: 'a-204' })], existants);
  assert.equal(l.raison, 'doublon_fort');
  assert.equal(l.doublons.length, 1); assert.equal(l.doublons[0].id, 'c2'); assert.equal(l.doublons[0].raisonAncienNumero, true);
  const [p] = classerLignes([cand(3, { nom: 'Nouveau' })], existants);
  assert.equal(p.raison, ''); assert.deepEqual(p.doublons, []);
  const [e] = classerLignes([cand(4, { email: 'a@b.fr' })], existants);
  assert.equal(e.statut, 'ecartee'); assert.equal(e.raison, 'sans_nom');
});
test('même fichier déposé deux fois : rien n\'est recréé par défaut', () => {
  const fichier = [cand(2, { nom: 'Roux', prenom: 'Paul', code_postal: '31000' }), cand(3, { nom: 'Martin', prenom: 'Léa', ancien_numero: 'A-204' })];
  const classees = classerLignes(fichier, existants);
  assert.equal(bilan(classees, aucun()).importees, 0);
});
test('doublon dans le fichier : la première ligne est gardée', () => {
  const r = classerLignes([cand(2, { nom: 'Petit', prenom: 'Luc', code_postal: '81000' }), cand(3, { nom: 'PETIT', prenom: 'luc', code_postal: '81000' })], []);
  assert.deepEqual(r.map((l) => l.statut), ['prete', 'doublon_fichier']);
  assert.deepEqual(r[1].doublons, [{ numero: 2 }]);
});
test('doublon du fichier : l\'ordre des tests prime sur la base', () => {
  const r = classerLignes([
    cand(2, { nom: 'Roux', prenom: 'Paul', code_postal: '31000' }),
    cand(3, { nom: 'Roux', prenom: 'Paul', code_postal: '31000' }),
  ], existants);
  assert.deepEqual(r.map((l) => l.statut), ['doublon_fort', 'doublon_fichier']);
  assert.deepEqual(r[1].doublons, [{ numero: 2 }]);
});
test('doublon du fichier : même ancien numéro, ou même nom + téléphone', () => {
  const r = classerLignes([
    cand(2, { nom: 'A', ancien_numero: 'X1' }), cand(3, { nom: 'B', ancien_numero: 'x1' }),
    cand(4, { nom: 'Gris', prenom: 'Ana', telephone: '0611223344' }), cand(5, { nom: 'Gris', prenom: 'Ana', telephone: '06 11 22 33 44' }),
    cand(6, { nom: 'Gris', prenom: 'Ana', code_postal: '12000' }),
  ], []);
  assert.deepEqual(r.map((l) => l.statut), ['prete', 'doublon_fichier', 'prete', 'doublon_fichier', 'prete']);
});
test('une ligne écartée ne sert pas de référence dans le fichier', () => {
  const r = classerLignes([cand(2, { email: 'a@b.fr', ancien_numero: 'Z' }), cand(3, { nom: 'B', ancien_numero: 'Z' })], []);
  assert.deepEqual(r.map((l) => l.statut), ['ecartee', 'prete']);
});
test('invariant du bilan, quels que soient les choix', () => {
  const fichier = [cand(2, { nom: 'Nouveau' }), cand(3, { nom: 'Dupond', telephone: '0612345678' }), cand(4, { nom: 'Roux', prenom: 'Paul' }), cand(5, { email: 'x@y.fr' }), cand(6, { nom: 'Nouveau', code_postal: '1' })];
  const classees = classerLignes(fichier, existants);
  for (const choix of [aucun(), { importer: new Set([3]), ecarter: new Set([4]) }]) {
    const b = bilan(classees, choix);
    assert.equal(b.lues, 5);
    assert.equal(b.importees + b.doublons_ecartes + b.ecartees, b.lues);
    assert.equal(lignesPourEcriture(classees, choix).length, b.importees);
  }
});
test('aImporter : règles par statut', () => {
  const choix = { importer: new Set([1]), ecarter: new Set([2]) };
  assert.equal(aImporter({ numero: 9, statut: 'prete' }, choix), true);
  assert.equal(aImporter({ numero: 1, statut: 'doublon_fort' }, choix), true);
  assert.equal(aImporter({ numero: 9, statut: 'doublon_fort' }, choix), false);
  assert.equal(aImporter({ numero: 9, statut: 'doublon_faible' }, choix), true);
  assert.equal(aImporter({ numero: 2, statut: 'doublon_faible' }, choix), false);
  assert.equal(aImporter({ numero: 1, statut: 'doublon_fichier' }, choix), false);
  assert.equal(aImporter({ numero: 1, statut: 'ecartee' }, choix), false);
});
test('ligne à écrire : numéro de ligne, aucune organisation', () => {
  const [l] = lignesPourEcriture(classerLignes([cand(9, { nom: 'Blanc' })], []), aucun());
  assert.equal(l.import_line, 9); assert.equal(l.display_name, 'BLANC'); assert.ok(!('org_id' in l));
});
test('libellés des raisons', () => {
  assert.equal(LIBELLE_RAISON.sans_nom, 'Ni nom ni société');
  assert.equal(LIBELLE_RAISON.doublon_faible, 'Homonyme écarté');
});
test('5 000 lignes contre 5 000 clients : bien moins d\'une seconde', () => {
  const base = Array.from({ length: 5000 }, (_, i) => ({
    id: `c${i}`, first_name: `P${i}`, last_name: `NOM${i}`, phone: `06${String(10000000 + i)}`, email: `c${i}@x.fr`, postal_code: '81000', external_ref: `R${i}`,
  }));
  const fichier = Array.from({ length: 5000 }, (_, i) => cand(i + 2, i % 2 ? { nom: `NOM${i}`, prenom: `P${i}` } : { nom: `NEUF${i}`, prenom: 'X', telephone: `07${String(10000000 + i)}` }));
  const t = Date.now();
  const r = classerLignes(fichier, base);
  assert.ok(Date.now() - t < 1000, `trop lent : ${Date.now() - t} ms`);
  assert.equal(r.filter((l) => l.statut === 'doublon_fort').length, 2500);
  assert.equal(r.filter((l) => l.statut === 'prete').length, 2500);
});
