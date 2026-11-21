import { test } from 'node:test';
import assert from 'node:assert/strict';
import { champParCle } from '../../src/lib/importClients/champs.js';
import { normaliserValeur } from '../../src/lib/importClients/normaliser.js';

const n = (cle, brut) => normaliserValeur(champParCle(cle), brut);

test('téléphone : Excel a mangé le zéro', () => assert.deepEqual(n('telephone', '612345678'), { valeur: '06 12 34 56 78', illisible: false }));
test('téléphone : +33 et points', () => {
  assert.equal(n('telephone', '+33 6 12 34 56 78').valeur, '06 12 34 56 78');
  assert.equal(n('telephone', '06.12.34.56.78').valeur, '06 12 34 56 78');
  assert.equal(n('telephone', '0033612345678').valeur, '06 12 34 56 78');
});
test('téléphone étranger gardé tel quel, nettoyé', () => assert.equal(n('telephone', '+41 22 555 01 02').valeur, '+41 22 555 01 02'));
test('code postal : zéro retrouvé', () => {
  assert.equal(n('code_postal', '1000').valeur, '01000');
  assert.equal(n('code_postal', '81 600').valeur, '81600');
  assert.deepEqual(n('code_postal', 'CH-1200'), { valeur: 'CH-1200', illisible: false });
});
test('e-mail : minuscules ; invalide = illisible et vide', () => {
  assert.equal(n('email', ' Jean.DUPONT@Orange.FR ').valeur, 'jean.dupont@orange.fr');
  assert.deepEqual(n('email', 'pas un mail'), { valeur: null, illisible: true });
});
test('accord : vide = oui, « non » = non', () => {
  assert.equal(n('accepte_emails', '').valeur, true);
  assert.equal(n('accepte_emails', 'Oui').valeur, true);
  for (const v of ['non', 'Non', '0', 'faux', 'refus']) assert.equal(n('accepte_sms', v).valeur, false);
});
test('type de logement et de client', () => {
  assert.equal(n('type_logement', 'Appart').valeur, 'appartement');
  assert.equal(n('type_logement', 'Local commercial').valeur, 'local_commercial');
  assert.deepEqual(n('type_logement', 'yourte'), { valeur: null, illisible: true });
  assert.equal(n('type_client', 'Société').valeur, 'entreprise');
  assert.equal(n('type_client', 'Mairie').valeur, 'public');
  assert.equal(n('type_client', 'Particulier').valeur, 'particulier');
});
test('surface « 120 m² » = 120 ; année « vers 1980 » illisible', () => {
  assert.equal(n('surface', '120 m²').valeur, 120);
  assert.equal(n('surface', '85,5').valeur, 85.5);
  assert.deepEqual(n('surface', 'grande'), { valeur: null, illisible: true });
  assert.deepEqual(n('annee_construction', 'vers 1980'), { valeur: null, illisible: true });
  assert.deepEqual(n('annee_construction', '1980'), { valeur: 1980, illisible: false });
});
test('texte : espaces retirés', () => assert.equal(n('nom', '  Dupont '). valeur, 'Dupont'));
test('vide = null, jamais illisible', () => {
  assert.deepEqual(n('surface', '  '), { valeur: null, illisible: false });
  assert.deepEqual(n('nom', null), { valeur: null, illisible: false });
});
