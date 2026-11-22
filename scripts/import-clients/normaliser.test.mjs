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
test('téléphone : non reconnu = illisible, jamais gardé tel quel', () => {
  for (const v of ['néant', 'n/a', '06 12 34 56 78 / 05 63 00 00 00', '0612345678 poste 12', '06 12 34 56', '+33 6 12 34 56']) {
    assert.deepEqual(n('telephone', v), { valeur: null, illisible: true }, v);
  }
});
test('téléphone : +33 (0)6 retrouvé, international toujours accepté', () => {
  assert.equal(n('telephone', '+33 (0)6 12 34 56 78').valeur, '06 12 34 56 78');
  assert.equal(n('telephone', '+41 22 555 01 02').valeur, '+41 22 555 01 02');
  assert.equal(n('telephone', '0041 22 555 01 02').valeur, '0041 22 555 01 02');
});
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
test('type de client : pluriels et mots courants, le reste illisible', () => {
  const attendu = {
    particulier: ['Particuliers', 'Privé', 'privées', 'Personne physique', 'Personnes physiques', 'Client particulier', 'Clients particuliers',
      'Résidentiel', 'Propriétaire', 'Locataires', 'M', 'Mme', 'Mlle', 'Monsieur', 'Madame', 'PARTICULIER', ' particulier '],
    entreprise: ['Entreprises', 'Sociétés', 'Pro', 'PROS', 'Professionnel', 'Professionnelles', 'Personne morale', 'Artisan', 'Commerce',
      'Commerçant', 'SARL', 'SAS', 'SASU', 'EURL', 'SA', 'SCI', 'SNC', 'EI', 'Association', 'Syndic', 'Copropriété'],
    public: ['Public', 'Publique', 'Secteur public', 'Collectivités', 'Mairie', 'Commune', 'Administration', 'État', 'Département',
      'Région', 'Hôpital', 'École', 'Écoles'],
  };
  for (const [valeur, mots] of Object.entries(attendu)) for (const m of mots) assert.equal(n('type_client', m).valeur, valeur, m);
  for (const m of ['S.A.R.L.', 'S.A.', 'E.I.', 'Sarl.']) assert.equal(n('type_client', m).valeur, 'entreprise', m);
  assert.equal(n('type_client', 'M.').valeur, 'particulier');
  assert.equal(n('type_client', 'Hôpitaux').valeur, 'public');
  for (const m of ['?', '3', 'Client', 'divers', '.']) assert.deepEqual(n('type_client', m), { valeur: null, illisible: true }, m);
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
test('surface : bornée à moins de 100 000 m², arrondie au centième', () => {
  assert.deepEqual(n('surface', '85.33333333333333'), { valeur: 85.33, illisible: false });
  assert.deepEqual(n('surface', '99999,994'), { valeur: 99999.99, illisible: false });
  for (const v of ['33612345678', '100000', '0', '0,001', '-5']) assert.deepEqual(n('surface', v), { valeur: null, illisible: true }, v);
});
test('année de construction : quatre chiffres entre 1000 et 2100', () => {
  assert.deepEqual(n('annee_construction', '2100'), { valeur: 2100, illisible: false });
  assert.deepEqual(n('annee_construction', '1000'), { valeur: 1000, illisible: false });
  for (const v of ['19800', '0985', '2101', '980']) assert.deepEqual(n('annee_construction', v), { valeur: null, illisible: true }, v);
});
test('code postal : mention CEDEX retirée', () => {
  assert.equal(n('code_postal', '81600 CEDEX').valeur, '81600');
  assert.equal(n('code_postal', '81600 Cedex 2').valeur, '81600');
  assert.equal(n('code_postal', '81600').valeur, '81600');
});
