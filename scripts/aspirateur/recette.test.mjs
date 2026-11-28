// scripts/aspirateur/recette.test.mjs — validation d'une recette et codes d'erreur (src/lib/aspirateur/recette.js, codes.js).
// Run : node --test scripts/aspirateur/recette.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_RECETTE, validerRecette, recetteContientSecret } from '../../src/lib/aspirateur/recette.js';
import { CODES_ASPIRATEUR, messageAspirateur } from '../../src/lib/aspirateur/codes.js';

const ok = {
  schema: 1,
  domaine: 'pro.invicta-group.fr',
  listes: { departs: ['https://pro.invicta-group.fr/poeles'], lien_produit: 'a.produit' },
  produit: { nom: 'h1', reference: '.ref' },
};

test('recette minimale valide', () => {
  assert.equal(SCHEMA_RECETTE, 1);
  assert.deepEqual(validerRecette(ok), { ok: true, erreurs: [] });
});

test('recette avec connexion et documents valide', () => {
  const r = {
    ...ok,
    connexion: { url: 'https://pro.invicta-group.fr/login', champ_identifiant: '#email', champ_mot_de_passe: '#password', bouton: 'button[type=submit]', preuve: '.mon-compte' },
    listes: { ...ok.listes, suivant: 'a.next' },
    produit: { ...ok.produit, prix: '.prix', documents: [{ type: 'fiche_technique', selecteur: 'a.fiche' }] },
    politesse: { delai_ms: 1500 },
  };
  assert.deepEqual(validerRecette(r), { ok: true, erreurs: [] });
});

test('URL hors du domaine refusée', () => {
  assert.equal(validerRecette({ ...ok, listes: { ...ok.listes, departs: ['https://autre.fr/'] } }).ok, false);
  assert.equal(validerRecette({ ...ok, connexion: { url: 'https://evil.example/login', champ_identifiant: '#a', champ_mot_de_passe: '#b', bouton: 'button', preuve: '.x' } }).ok, false);
});

test('schéma, domaine, sélecteurs obligatoires, type de document', () => {
  assert.equal(validerRecette({ ...ok, schema: 2 }).ok, false);
  assert.equal(validerRecette({ ...ok, domaine: '' }).ok, false);
  assert.equal(validerRecette({ ...ok, produit: { nom: 'h1' } }).ok, false);
  assert.equal(validerRecette({ ...ok, listes: { departs: [], lien_produit: 'a' } }).ok, false);
  assert.equal(validerRecette({ ...ok, produit: { ...ok.produit, nom: 'x'.repeat(301) } }).ok, false);
  assert.equal(validerRecette({ ...ok, produit: { ...ok.produit, documents: [{ type: 'facture', selecteur: 'a' }] } }).ok, false);
  assert.equal(validerRecette({ ...ok, politesse: { delai_ms: 200 } }).ok, false);
  assert.equal(validerRecette(null).ok, false);
});

test('secret dans une recette détecté, sans casse ; secrets trop courts ignorés', () => {
  assert.equal(recetteContientSecret({ ...ok, produit: { ...ok.produit, nom: 'Bonjour ERIC@mayer.fr' } }, ['eric@mayer.fr', 'motdepasse']), true);
  assert.equal(recetteContientSecret(ok, ['', 'ab', null]), false);
  assert.equal(recetteContientSecret(ok, ['motdepasse']), false);
});

test('chaque code a un message ; code inconnu ou nul : message de repli', () => {
  for (const code of Object.keys(CODES_ASPIRATEUR)) assert.ok(messageAspirateur(code).length > 0);
  for (const code of ['acces_absents', 'acces_refuses', 'site_absent', 'site_protege', 'recette_obsolete', 'recette_refusee', 'recette_contient_secret', 'plafond_atteint', 'quota_atteint', 'deja_en_cours', 'service_indisponible', 'travail_inconnu', 'non_autorise', 'nature_prix_absente']) {
    assert.ok(Object.hasOwn(CODES_ASPIRATEUR, code), code);
  }
  assert.equal(messageAspirateur('n_existe_pas'), 'Erreur inattendue de l’aspirateur');
  assert.equal(messageAspirateur(null), 'Erreur inattendue de l’aspirateur');
});

test('relecture I4 : variantes encodées d’un secret (URL, formulaire, JSON, entités HTML)', async () => {
  const { variantesSecret } = await import('../../src/lib/aspirateur/recette.js');
  const v = variantesSecret('jean x@a"b.fr');
  for (const attendu of ['jean x@a"b.fr', 'jean%20x%40a%22b.fr', 'jean+x%40a%22b.fr', 'jean x@a\\"b.fr', 'jean x&#64;a&quot;b.fr']) {
    assert.ok(v.includes(attendu), `variante absente : ${attendu}`);
  }
  assert.deepEqual(variantesSecret('ab'), []);
  assert.equal(recetteContientSecret({ ...ok, produit: { ...ok.produit, nom: 'a[href*="jean%40mayer.fr"]' } }, ['jean@mayer.fr']), true);
  assert.equal(recetteContientSecret({ ...ok, produit: { ...ok.produit, nom: 'p"x' } }, ['p"x']), true);
});

test('relecture I5 : une adresse de recette ne porte ni session ni jeton', () => {
  for (const u of ['https://pro.invicta-group.fr/poeles;jsessionid=AB12', 'https://pro.invicta-group.fr/poeles?sid=1', 'https://pro.invicta-group.fr/poeles?PHPSESSID=x', 'https://pro.invicta-group.fr/p?token=abc', 'https://pro.invicta-group.fr/p?a=1&auth=z']) {
    assert.equal(validerRecette({ ...ok, listes: { ...ok.listes, departs: [u] } }).ok, false, u);
  }
  assert.equal(validerRecette({ ...ok, listes: { ...ok.listes, departs: ['https://pro.invicta-group.fr/poeles?page=2&marque=deville'] } }).ok, true);
});
