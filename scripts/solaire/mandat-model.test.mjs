import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMandatModel } from '../../src/apps/solaire/lib/demarches/mandatModel.js';

const company = {
  name: 'Soleil SAS', legalName: 'SOLEIL SAS', legalForm: 'SAS', capital: '10 000', rcs: 'Albi 123 456 789',
  siret: '123 456 789 00012', address: '1 rue du Soleil', postalCode: '81600', city: 'Gaillac',
  signatoryName: 'Jean Martin', signatoryRole: 'Président', signatorySignaturePath: 'org/branding/signature-mandat.png',
  websiteUrl: 'https://soleil.example',
};
const declarant = { civilite: 'M.', nom: 'Dupont', prenom: 'Paul', date_naissance: '1975-03-12', naissance_commune: 'Toulouse', naissance_departement: '31' };
const adresseDeclarant = { numero: '12', voie: 'rue des Lilas', lieudit: '', code_postal: '81600', localite: 'Gaillac' };
const cadastre = { commune_insee: '81099', nom_com: 'Gaillac', parcelles: [{ section: 'AB', numero: '12' }, { section: 'AB', numero: '13' }] };
const consent = { signataire_nom: 'Paul Dupont', lieu: 'Gaillac', signed_at: '2026-10-08T10:15:00.000Z', signature_path: 'x/signature.png' };
const base = {
  declarant, adresseDeclarant, cadastre, company, consent,
  site: { adresse: '12 rue des Lilas', code_postal: '81600', commune: 'Gaillac' },
  projet: { puissance_kwc: 6, mode_valorisation: 'autoconso_surplus' },
  devis: { numero: 'D-2026-042', date: '2026-10-01' },
  dateLabel: '8 octobre 2026',
};

test('mandat complet : parties, site, 6 articles, signatures, aucune alerte', () => {
  const m = buildMandatModel(base);
  assert.ok(m.titre.includes('Mandat spécial de représentation'));
  assert.ok(m.mandant.nom.includes('Paul') && m.mandant.nom.includes('Dupont'));
  assert.ok(m.mandant.naissance.includes('12/03/1975') && m.mandant.naissance.includes('Toulouse'));
  assert.ok(m.mandant.domicile.includes('12 rue des Lilas') && m.mandant.domicile.includes('81600'));
  assert.ok(m.mandataire.denomination.includes('SOLEIL SAS'));
  assert.ok(m.mandataire.signataire.includes('Jean Martin') && m.mandataire.signataire.includes('Président'));
  assert.equal(m.site.parcelles, 'AB 12, AB 13 (commune INSEE 81099)');
  assert.ok(m.site.nature.includes('6 kWc') && m.site.nature.includes('vente du surplus'));
  assert.ok(m.site.devis.includes('D-2026-042'));
  assert.equal(m.articles.length, 6);
  assert.deepEqual(m.articles.map((a) => a.numero), [1, 2, 3, 4, 5, 6]);
  assert.equal(m.signatures.mandant.lieu, 'Gaillac');
  assert.equal(m.signatures.mandant.date, '08/10/2026');
  assert.equal(m.signatures.mandataire.lieu, 'Gaillac');
  assert.equal(m.alertes.length, 0);
});

test('article 1 : DP + Enedis (demande complète en surplus, CACSI en totale) ; article 3 : contrat de rachat seulement en surplus', () => {
  const surplus = buildMandatModel(base);
  const a1 = surplus.articles[0].paragraphes.join(' ');
  assert.ok(a1.includes('déclaration préalable') && a1.includes('obligation d’achat'));
  assert.ok(surplus.articles[2].paragraphes.join(' ').includes('contrat d’achat'));
  const totale = buildMandatModel({ ...base, projet: { puissance_kwc: 6, mode_valorisation: 'autoconso_totale' } });
  const t1 = totale.articles[0].paragraphes.join(' ');
  assert.ok(t1.includes('CACSI') && !t1.includes('obligation d’achat'));
  assert.ok(!totale.articles[2].paragraphes.join(' ').includes('contrat d’achat'));
  assert.ok(totale.site.nature.includes('sans injection'));
});

test('article 2 : cases Enedis (signature contractuelle et règlements cochées, L.342-2 non cochée) ; article 5 : effet à l’acceptation du devis', () => {
  const m = buildMandatModel(base);
  const cases = m.articles[1].cases;
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((c) => c.cochee), [true, true, false]);
  const a5 = m.articles[4].paragraphes.join(' ');
  assert.ok(a5.includes('D-2026-042') && a5.includes('douze mois'));
});

test('alertes : signataire org absent, devis absent, consentement absent', () => {
  const m = buildMandatModel({
    ...base,
    company: { ...company, signatoryName: '', signatoryRole: '', signatorySignaturePath: '' },
    devis: { numero: '', date: '' },
    consent: null,
  });
  const codes = m.alertes.map((a) => a.code).sort();
  assert.deepEqual(codes, ['consentement_manquant', 'devis_manquant', 'signataire_manquant']);
  assert.ok(m.mandataire.signataire.includes('à renseigner'));
  assert.ok(m.articles[4].paragraphes.join(' ').includes('devis à préciser'));
  assert.equal(m.signatures.mandant.date, '8 octobre 2026'); // repli : date d'édition
});

test('aucun glyphe hors Helvetica dans le texte du mandat', () => {
  const m = buildMandatModel(base);
  const texte = JSON.stringify(m);
  assert.ok(!/[≤≥→←▲▼−☑☐]/.test(texte), 'glyphe non supporté par Helvetica');
});
