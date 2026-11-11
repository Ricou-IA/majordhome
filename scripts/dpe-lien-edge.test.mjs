// node --test scripts/dpe-lien-edge.test.mjs — règles pures de l'edge function dpe-lien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroValide, adresseDeRecherche, codeDepuisCorpus, resumeDossier, CODES } from '../supabase/functions/dpe-lien/regles.js';

test('numeroValide : 13 alphanumériques oui, 12 non, espace non, non-chaîne non', () => {
  assert.equal(numeroValide('2662E2065219C'), true);
  assert.equal(numeroValide('2662E2065219'), false);
  assert.equal(numeroValide('2662E 065219C'), false);
  assert.equal(numeroValide('2662E2065219C '), false);
  assert.equal(numeroValide(null), false);
  assert.equal(numeroValide(2662), false);
});

test('adresseDeRecherche : rue + CP + ville, espaces normalisés', () => {
  assert.equal(adresseDeRecherche({ address: ' 12  rue X ', postal_code: '81600', city: 'Gaillac' }), '12 rue X 81600 Gaillac');
});

test('adresseDeRecherche : rue + ville sans CP reste cherchable', () => {
  assert.equal(adresseDeRecherche({ address: '12 rue X', postal_code: null, city: 'Gaillac' }), '12 rue X Gaillac');
});

test('adresseDeRecherche : ville seule, rue seule ou client absent ⇒ null', () => {
  assert.equal(adresseDeRecherche({ address: '', postal_code: '81600', city: 'Gaillac' }), null);
  assert.equal(adresseDeRecherche({ address: '12 rue X', postal_code: '', city: '  ' }), null);
  assert.equal(adresseDeRecherche(null), null);
});

test('codeDepuisCorpus : 503 et 401 ⇒ indisponible, 404 ⇒ absent, 400 ⇒ mal formé, 200 ⇒ null', () => {
  assert.equal(codeDepuisCorpus(503, 'base dossier en cours de construction'), 'corpus_indisponible');
  assert.equal(codeDepuisCorpus(401, 'secret absent ou invalide'), 'corpus_indisponible');
  assert.equal(codeDepuisCorpus(404, 'dossier absent de la vue'), 'numero_absent');
  assert.equal(codeDepuisCorpus(400, 'numero mal forme'), 'numero_mal_forme');
  assert.equal(codeDepuisCorpus(200, null), null);
  assert.equal(codeDepuisCorpus(200, 'erreur dans un 200'), 'corpus_indisponible');
});

test('codeDepuisCorpus ne rend que des codes connus', () => {
  for (const statut of [200, 400, 401, 404, 500, 503]) {
    const code = codeDepuisCorpus(statut, 'x');
    assert.ok(code === null || CODES.includes(code));
  }
});

test('resumeDossier : champs lus, champs absents ⇒ null et jamais undefined', () => {
  assert.deepEqual(
    resumeDossier({ classe_bilan_dpe: 'D', date_etablissement_dpe: '2023-04-02', surface_habitable_logement: 96, type_bien: 'maison' }),
    { etiquette: 'D', date: '2023-04-02', surface: 96, type: 'maison' },
  );
  assert.deepEqual(resumeDossier({}), { etiquette: null, date: null, surface: null, type: null });
  assert.deepEqual(resumeDossier(null), { etiquette: null, date: null, surface: null, type: null });
});
