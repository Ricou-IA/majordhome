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

test('un synonyme ne désigne qu\'un champ', () => {
  const vus = new Map();
  for (const c of CHAMPS) for (const s of [c.libelle, ...c.synonymes]) {
    const k = cleEntete(s);
    assert.ok(!vus.has(k) || vus.get(k) === c.cle, `${s} désigne ${vus.get(k)} et ${c.cle}`);
    vus.set(k, c.cle);
  }
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
