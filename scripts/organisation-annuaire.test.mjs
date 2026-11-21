import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formeJuridiqueDepuisNature, signataireDepuisDirigeants, lireSuggestions, identiteEnregistree, appliquerEntreprise,
} from '../src/lib/organisation/annuaire.js';

// Réponse de l'annuaire écrite à la main (entreprises fictives), à la forme de /search.
const REPONSE = {
  results: [
    {
      siren: '100288224',
      nom_raison_sociale: 'ATELIER DU CHAUFFAGE',
      nom_complet: 'ATELIER DU CHAUFFAGE',
      nature_juridique: '5710',
      siege: { siret: '10028822400015', adresse: '26 RUE DES PYRENEES 81600 GAILLAC', code_postal: '81600', libelle_commune: 'GAILLAC', etat_administratif: 'A' },
      matching_etablissements: [
        { siret: '10028822400023', adresse: '3 PLACE DU MARCHE 81000 ALBI', code_postal: '81000', libelle_commune: 'ALBI', etat_administratif: 'F' },
      ],
      dirigeants: [
        { type_dirigeant: 'personne morale', denomination: 'HOLDING X', qualite: 'Commissaire aux comptes' },
        { type_dirigeant: 'personne physique', nom: 'martin', prenoms: 'JEAN-PIERRE LOUIS', qualite: 'Président de SAS' },
      ],
    },
    {
      siren: '200300400',
      nom_raison_sociale: 'ASSOCIATION DES ARTISANS',
      nature_juridique: 9220,
      siege: { siret: '20030040000011', adresse: '1 RUE HAUTE 31000 TOULOUSE', code_postal: '31000', libelle_commune: 'TOULOUSE', etat_administratif: 'A' },
      dirigeants: [{ type_dirigeant: 'personne morale', denomination: 'HOLDING Y', qualite: 'Président' }],
    },
    { siren: 'abc', siege: { siret: '1' } },
    { siren: '300400500', nom_raison_sociale: 'SANS ETABLISSEMENT' },
  ],
};

const VIDE = { brand_name: '', legal_name: '', legal_form: '', capital: '', siret: '', rcs: '', tva_intra: '', insurance: '', signatory_name: '', signatory_role: '' };

test('nature juridique → forme du formulaire', () => {
  assert.equal(formeJuridiqueDepuisNature('5710'), 'SAS');
  assert.equal(formeJuridiqueDepuisNature(5720), 'SAS à associé unique');
  assert.equal(formeJuridiqueDepuisNature('5498'), 'EURL');
  assert.equal(formeJuridiqueDepuisNature('5499'), 'SARL');
  assert.equal(formeJuridiqueDepuisNature('5599'), 'SA');
  assert.equal(formeJuridiqueDepuisNature('5410'), null);
  assert.equal(formeJuridiqueDepuisNature('1000'), 'EI');
  assert.equal(formeJuridiqueDepuisNature('9220'), null);
  assert.equal(formeJuridiqueDepuisNature(null), null);
});

test('signataire : président personne physique, jamais une personne morale', () => {
  assert.deepEqual(signataireDepuisDirigeants(REPONSE.results[0].dirigeants), { nom: 'Jean-Pierre Louis MARTIN', fonction: 'Président' });
  assert.equal(signataireDepuisDirigeants(REPONSE.results[1].dirigeants), null);
  assert.equal(signataireDepuisDirigeants(undefined), null);
});

test('recherche par nom : le siège, résultats illisibles écartés', () => {
  const liste = lireSuggestions(REPONSE, 'atelier');
  assert.equal(liste.length, 2);
  assert.deepEqual(
    { ...liste[0], signataire: undefined },
    {
      siret: '10028822400015', siren: '100288224', raison_sociale: 'ATELIER DU CHAUFFAGE', forme_juridique: 'SAS', nature_juridique: '5710',
      adresse: '26 RUE DES PYRENEES', code_postal: '81600', ville: 'GAILLAC', etat: 'actif', signataire: undefined,
    },
  );
  assert.equal(liste[1].forme_juridique, null);
  assert.equal(liste[1].nature_juridique, '9220');
});

test('SIRET tapé : cet établissement, même secondaire et fermé', () => {
  const [e] = lireSuggestions(REPONSE, '100 288 224 00023');
  assert.equal(e.siret, '10028822400023');
  assert.equal(e.ville, 'ALBI');
  assert.equal(e.etat, 'ferme');
  assert.equal(lireSuggestions(REPONSE, '99999999999999').length, 0);
  assert.deepEqual(lireSuggestions(null, 'x'), []);
  assert.deepEqual(lireSuggestions({ results: 'non' }, 'x'), []);
});

test('identité enregistrée : un nom et un SIRET complet', () => {
  assert.equal(identiteEnregistree({ brand_name: 'A', siret: '100 288 224 00015' }), true);
  assert.equal(identiteEnregistree({ brand_name: 'A', siret: '100 288 224' }), false);
  assert.equal(identiteEnregistree({ siret: '10028822400015' }), false);
  assert.equal(identiteEnregistree(null), false);
});

test('report sur une fiche vide : tout est rempli', () => {
  const [e] = lireSuggestions(REPONSE, 'atelier');
  const r = appliquerEntreprise(VIDE, e);
  assert.equal(r.form.brand_name, 'ATELIER DU CHAUFFAGE');
  assert.equal(r.form.legal_name, 'ATELIER DU CHAUFFAGE');
  assert.equal(r.form.legal_form, 'SAS');
  assert.equal(r.form.siret, '100 288 224 00015');
  assert.equal(r.form.tva_intra, 'FR 75 100288224');
  assert.equal(r.form.signatory_name, 'Jean-Pierre Louis MARTIN');
  assert.equal(r.form.signatory_role, 'Président');
  assert.deepEqual(r.siege, { address: '26 RUE DES PYRENEES', postal_code: '81600', city: 'GAILLAC' });
  assert.match(r.detail, /^Rempli : nom commercial, raison sociale, SIRET, forme juridique \(SAS\), n° TVA, adresse du siège/);
  assert.equal(r.avertissement, null);
});

test('report sur une fiche remplie : nom commercial et signataire gardés, forme jamais héritée', () => {
  const [, asso] = lireSuggestions(REPONSE, 'atelier');
  const avant = { ...VIDE, brand_name: 'Mon enseigne', legal_form: 'SARL', signatory_name: 'Anne DUPONT', capital: '6 000' };
  const r = appliquerEntreprise(avant, asso);
  assert.equal(r.form.brand_name, 'Mon enseigne');
  assert.equal(r.form.signatory_name, 'Anne DUPONT');
  assert.equal(r.form.capital, '6 000');
  assert.equal(r.form.legal_form, '');
  assert.match(r.avertissement, /forme juridique à choisir à la main \(nature juridique INSEE 9220\)/);
  assert.doesNotMatch(r.detail, /nom commercial|signataire/);
});

test('établissement fermé : on avertit, on ne bloque pas', () => {
  const [ferme] = lireSuggestions(REPONSE, '10028822400023');
  const r = appliquerEntreprise(VIDE, ferme);
  assert.equal(r.form.siret, '100 288 224 00023');
  assert.match(r.avertissement, /fermé dans l’annuaire/);
});
