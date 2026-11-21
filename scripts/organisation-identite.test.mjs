import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSION_IDENTITE, CHAMPS_IDENTITE, CLES_IDENTITE, CLES_COORDONNEES,
  formatSiret, formatTva, formatTelephone, prefixerHttps, tvaDepuisSiret,
  validerSaisie, validerEnvoi, identitePourEnvoi, formaterPourSaisie,
} from '../src/lib/organisation/identite.js';

const COMPLETE = {
  brand_name: 'Atelier du Chauffage', legal_name: 'ATELIER DU CHAUFFAGE', legal_form: 'SAS', capital: '6 000',
  siret: '100 288 224 00015', tva_intra: 'FR 75 100288224', rcs: '100 288 224 R.C.S. Albi', insurance: 'RC pro',
  address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 33 23 14',
  website_url: 'exemple.fr', signatory_name: 'Jean MARTIN', signatory_role: 'Président',
};

test('quinze champs, tous rangés dans un onglet sauf aucun', () => {
  assert.equal(CHAMPS_IDENTITE.length, 15);
  assert.deepEqual([...CLES_IDENTITE, ...CLES_COORDONNEES].sort(), CHAMPS_IDENTITE.map((c) => c.cle).sort());
  assert.equal(typeof VERSION_IDENTITE, 'number');
});

test('formats de saisie', () => {
  assert.equal(formatSiret('10028822400015'), '100 288 224 00015');
  assert.equal(formatSiret('1002882240001599'), '100 288 224 00015');
  assert.equal(formatSiret('1002'), '100 2');
  assert.equal(formatTva('fr75100288224'), 'FR 75 100288224');
  assert.equal(formatTva(''), '');
  assert.equal(formatTelephone('0563332314'), '05 63 33 23 14');
  assert.equal(prefixerHttps('exemple.fr'), 'https://exemple.fr');
  assert.equal(prefixerHttps('http://exemple.fr'), 'http://exemple.fr');
  assert.equal(prefixerHttps('  '), '');
});

test('la TVA se calcule du SIREN', () => {
  assert.equal(tvaDepuisSiret('100 288 224 00015'), 'FR75100288224');
  assert.equal(tvaDepuisSiret('10028822400015'), 'FR75100288224');
  assert.equal(tvaDepuisSiret('100 288 224'), '');
  assert.equal(tvaDepuisSiret(null), '');
});

test('contrôle d’écran : obligatoires et formats', () => {
  assert.deepEqual(validerSaisie(COMPLETE, CLES_IDENTITE), {});
  assert.deepEqual(validerSaisie(COMPLETE, CLES_COORDONNEES), {});
  assert.deepEqual(validerSaisie({}, CLES_IDENTITE), { brand_name: 'Obligatoire' });
  assert.deepEqual(Object.keys(validerSaisie({}, CLES_COORDONNEES)).sort(), ['address', 'city', 'phone', 'postal_code']);
  assert.match(validerSaisie({ ...COMPLETE, siret: '100 288 224 0001' }, CLES_IDENTITE).siret, /14 chiffres/);
  assert.match(validerSaisie({ ...COMPLETE, tva_intra: 'FR 75' }, CLES_IDENTITE).tva_intra, /FR \+ 2 chiffres/);
  assert.equal(validerSaisie({ ...COMPLETE, brand_name: 'x'.repeat(81) }, CLES_IDENTITE).brand_name, 'Maximum 80 caractères');
  assert.equal(validerSaisie({ ...COMPLETE, postal_code: '8160' }, CLES_COORDONNEES).postal_code, '5 chiffres attendus');
  assert.match(validerSaisie({ ...COMPLETE, phone: '05 63' }, CLES_COORDONNEES).phone, /10 chiffres/);
  assert.match(validerSaisie({ ...COMPLETE, website_url: 'pas un site' }, CLES_COORDONNEES).website_url, /invalide/);
  // un onglet ne juge pas les champs de l'autre
  assert.deepEqual(validerSaisie({ brand_name: 'A' }, CLES_IDENTITE), {});
});

test('forme d’envoi : quinze clés, numéros sans espaces', () => {
  const { version, identite } = identitePourEnvoi(COMPLETE);
  assert.equal(version, VERSION_IDENTITE);
  assert.equal(Object.keys(identite).length, 15);
  assert.equal(identite.siret, '10028822400015');
  assert.equal(identite.tva_intra, 'FR75100288224');
  assert.equal(identite.phone, '0563332314');
  assert.equal(identite.website_url, 'https://exemple.fr');
  assert.deepEqual(validerEnvoi(identite), {});
  // réglages vides : quinze chaînes vides, jamais undefined
  assert.ok(Object.values(identitePourEnvoi(null).identite).every((v) => v === ''));
});

test('contrôle d’envoi : coordonnées vides acceptées, formats refusés', () => {
  assert.deepEqual(validerEnvoi(identitePourEnvoi({ brand_name: 'Entreprise neuve' }).identite), {});
  assert.deepEqual(validerEnvoi(identitePourEnvoi({}).identite), { brand_name: 'Obligatoire' });
  assert.ok(validerEnvoi({ ...identitePourEnvoi(COMPLETE).identite, siret: '1002882240001' }).siret);
});

test('aller-retour : la forme d’envoi redonne la forme enregistrée', () => {
  const { identite } = identitePourEnvoi(COMPLETE);
  for (const cle of ['siret', 'tva_intra', 'phone', 'brand_name', 'city']) {
    assert.equal(formaterPourSaisie(cle, identite[cle]), COMPLETE[cle], cle);
  }
});
