import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAMPS, CIBLES_COMPOSEES, CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR,
  champParCle, cleEntete, cibleDepuisEntete,
} from '../../src/lib/importClients/champs.js';

test('vingt champs, clés et colonnes uniques', () => {
  assert.equal(CHAMPS.length, 20);
  assert.equal(new Set(CHAMPS.map((c) => c.cle)).size, 20);
  assert.equal(new Set(CHAMPS.map((c) => c.colonne)).size, 20);
});

test('un synonyme ne désigne qu\'un champ (cibles composées comprises)', () => {
  const vus = new Map();
  const entrees = [
    ...CHAMPS.flatMap((c) => [c.libelle, ...c.synonymes].map((s) => [s, c.cle])),
    ...CIBLES_COMPOSEES.flatMap((c) => c.synonymes.map((s) => [s, c.cle])),
  ];
  for (const [s, cle] of entrees) {
    const k = cleEntete(s);
    assert.ok(!vus.has(k) || vus.get(k) === cle, `${s} désigne ${vus.get(k)} et ${cle}`);
    vus.set(k, cle);
  }
});

test('en-têtes d\'une colonne qui remplit plusieurs champs', () => {
  for (const e of ['Adresse complète', 'ADRESSE COMPLETE', 'Adresse postale complète', 'Adresse de facturation', 'Adresse du client']) {
    assert.equal(cibleDepuisEntete(e), '@adresse_complete', e);
  }
  for (const e of ['Nom complet', 'Nom et prénom', 'Nom prénom']) assert.equal(cibleDepuisEntete(e), '@nom_prenom', e);
  // « Contact » et « Client » portent souvent un téléphone ou un numéro : jamais présélectionnés en nom + prénom.
  assert.equal(cibleDepuisEntete('Contact'), '');
  assert.equal(cibleDepuisEntete('Client'), '');
  assert.equal(cibleDepuisEntete('Nom du client'), 'nom');
  for (const e of ['Prénom et nom', 'Prénom nom']) assert.equal(cibleDepuisEntete(e), '@prenom_nom', e);
  for (const e of ['CP Ville', 'CP / Ville', 'Code postal et ville', 'Code postal ville', 'CP et ville']) assert.equal(cibleDepuisEntete(e), '@cp_ville', e);
  // Les en-têtes simples restent les leurs.
  assert.equal(cibleDepuisEntete('Adresse'), 'adresse');
  assert.equal(cibleDepuisEntete('Adresse postale'), 'adresse');
  assert.equal(cibleDepuisEntete('Nom client'), 'nom');
  assert.equal(cibleDepuisEntete('Code postal'), 'code_postal');
});

test('en-têtes courants reconnus', () => {
  assert.equal(cibleDepuisEntete('Tél. portable'), 'telephone');
  assert.equal(cibleDepuisEntete('CP'), 'code_postal');
  assert.equal(cibleDepuisEntete('RAISON SOCIALE'), 'societe');
  assert.equal(cibleDepuisEntete('E-mail'), 'email');
  assert.equal(cibleDepuisEntete('N° client'), 'ancien_numero');
  assert.equal(cibleDepuisEntete('Code agence'), '');
});

test('portable, fixe et libellés exacts', () => {
  assert.equal(cibleDepuisEntete('Portable'), 'telephone');
  assert.equal(cibleDepuisEntete('Téléphone fixe'), 'telephone_2');
  assert.equal(cibleDepuisEntete('Téléphone'), 'telephone');
  assert.equal(cibleDepuisEntete('Remarques'), 'notes_internes');
  assert.equal(champParCle('email').libelle, 'E-mail');
  assert.equal(champParCle('telephone').libelle, 'Téléphone');
});

test('cleEntete : minuscules, sans accent ni ponctuation', () => {
  assert.equal(cleEntete('  Téléphone   (fixe) '), 'telephone fixe');
  assert.equal(cleEntete('E-mail'), 'e mail');
});

test('champParCle et cibles', () => {
  assert.equal(champParCle('nom').colonne, 'last_name');
  assert.equal(champParCle('inconnu'), null);
  assert.deepEqual(CIBLES_COMPOSEES.map((c) => c.cle), ['@nom_prenom', '@prenom_nom', '@cp_ville', '@adresse_complete']);
  assert.deepEqual(CIBLES_COMPOSEES[3].remplit, ['adresse', 'code_postal', 'ville']);
  assert.deepEqual([CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR], ['@notes', '@ignorer', '']);
});

test('notes : les en-têtes génériques vont aux notes internes, jamais aux notes vues par le client', () => {
  for (const e of ['Note', 'Observations', 'Informations', 'Remarques', 'Commentaires', 'Commentaire']) {
    assert.equal(cibleDepuisEntete(e), 'notes_internes', e);
  }
  assert.equal(champParCle('notes').libelle, 'Notes (visibles par le client)');
  assert.equal(champParCle('notes_internes').libelle, 'Notes internes');
  assert.equal(champParCle('notes').synonymes.length, 0);
});
