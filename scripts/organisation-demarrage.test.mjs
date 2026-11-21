import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapesDeDemarrage } from '../src/lib/organisation/demarrage.js';

const COMPLETE = {
  brand_name: 'Atelier du Chauffage', legal_name: 'ATELIER DU CHAUFFAGE', legal_form: 'SAS', capital: '6 000',
  siret: '100 288 224 00015', tva_intra: 'FR 75 100288224', rcs: '100 288 224 R.C.S. Albi', insurance: 'RC pro',
  address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 33 23 14',
  logo_url: 'https://exemple.fr/logo.png', from_email: 'contact@exemple.fr',
  territoire_centers: { siege: { label: 'Siège', lat: 43.9, lng: 1.9 } },
};
const fait = (s) => Object.fromEntries(etapesDeDemarrage(s).map((e) => [e.cle, e.fait]));

test('une entreprise sans réglage n’a rien de fait', () => {
  for (const f of [null, {}]) {
    const r = fait(f);
    assert.ok(Object.keys(r).length >= 4);
    assert.ok(Object.values(r).every((v) => v === false));
  }
});

test('une étape cesse d’être à faire dès que son réglage est posé', () => {
  const r = fait(COMPLETE);
  assert.equal(r.logo, true);
  assert.equal(r.siege, true);
  assert.equal(r.coordonnees, true);
});

test('un siège sans position n’est pas un siège sur la carte', () => {
  assert.equal(fait({ ...COMPLETE, territoire_centers: { siege: { label: 'Siège', lat: null, lng: null } } }).siege, false);
});

test('l’adresse d’envoi n’est proposée qu’avec le module Communication', () => {
  const ouvert = etapesDeDemarrage({ ...COMPLETE, from_email: '', modules: { communication: true } });
  const ferme = etapesDeDemarrage({ ...COMPLETE, from_email: '', modules: { communication: false } });
  assert.equal(ouvert.find((e) => e.cle === 'expediteur')?.fait, false);
  assert.equal(ferme.find((e) => e.cle === 'expediteur'), undefined);
});
