import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemblerInputsDemarches, dateDepartParDefaut } from '../../src/apps/solaire/lib/demarchesInputs.js';

const state = {
  location: { address: '12 rue des Lilas 81600 Gaillac' },
  cadastre: [{ code_insee: '81099', nom_com: 'Gaillac', section: 'AB', numero: '12' }],
  abf: { secteur_protege: false, source: 'gpu' },
  optim: { batteryOn: true },
};
const company = { rgeCertifications: ['QualiPV'] };
const AUJ = '2026-10-08';

test('dérivés : INSEE et commune depuis le dossier, repli sur le wizard', () => {
  const d = assemblerInputsDemarches({
    state, dossier: { cadastre: { commune_insee: '81004', nom_com: 'Albi' } }, activeKwc: 6, company, aujourdhui: AUJ,
  });
  assert.equal(d.commune_insee, '81004');
  assert.equal(d.commune_nom, 'Albi');
  const w = assemblerInputsDemarches({ state, dossier: null, activeKwc: 6, company, aujourdhui: AUJ });
  assert.equal(w.commune_insee, '81099');
  assert.equal(w.commune_nom, 'Gaillac');
});

test('dérivés : puissance, batterie, abf, RGE ne sont jamais figés', () => {
  const d = assemblerInputsDemarches({
    state, dossier: { abf: { secteur_protege: true }, demarches: { inputs: { puissance_kwc: 3, batterie: false, abf: null, installateur_rge: false } } },
    activeKwc: 9, company, aujourdhui: AUJ,
  });
  assert.equal(d.puissance_kwc, 9);
  assert.equal(d.batterie, true);
  assert.deepEqual(d.abf, { secteur_protege: true });
  assert.equal(d.installateur_rge, true);
  const sansRge = assemblerInputsDemarches({ state, dossier: null, activeKwc: 9, company: { rgeCertifications: [] }, aujourdhui: AUJ });
  assert.equal(sansRge.installateur_rge, false);
});

test('saisies : défauts sans dossier, reprises depuis dossier.demarches.inputs', () => {
  const def = assemblerInputsDemarches({ state, dossier: null, activeKwc: 6, company, aujourdhui: AUJ });
  assert.equal(def.mode_valorisation, 'autoconso_surplus');
  assert.equal(def.copropriete_ou_lotissement, 'aucun');
  assert.equal(def.compteur_linky, true);
  assert.deepEqual(def.prise_en_charge, {});
  assert.deepEqual(def.devis, { numero: '', date: '' });
  assert.equal(def.date_depart, AUJ);
  const repris = assemblerInputsDemarches({
    state, activeKwc: 6, company, aujourdhui: AUJ,
    dossier: { demarches: { inputs: {
      mode_valorisation: 'autoconso_totale', copropriete_ou_lotissement: 'lotissement', compteur_linky: false,
      date_depart: '2026-11-02', prise_en_charge: { consuel: 'inclus' }, devis: { numero: 'D-2026-042', date: '2026-10-01' },
    } } },
  });
  assert.equal(repris.mode_valorisation, 'autoconso_totale');
  assert.equal(repris.copropriete_ou_lotissement, 'lotissement');
  assert.equal(repris.compteur_linky, false);
  assert.equal(repris.date_depart, '2026-11-02');
  assert.deepEqual(repris.prise_en_charge, { consuel: 'inclus' });
  assert.equal(repris.devis.numero, 'D-2026-042');
});

test('dateDepartParDefaut : date de génération des documents si le dossier est validé, sinon aujourd’hui', () => {
  assert.equal(dateDepartParDefaut(null, AUJ), AUJ);
  assert.equal(dateDepartParDefaut({ status: 'offre', documents: null }, AUJ), AUJ);
  assert.equal(dateDepartParDefaut({ status: 'dossier_valide', documents: { cerfa: { path: 'x', generated_at: '2026-09-30T14:12:00.000Z' } } }, AUJ), '2026-09-30');
  assert.equal(dateDepartParDefaut({ status: 'dossier_valide', documents: { cerfa_pdf_path: 'x', generated_at: '2026-09-28T08:00:00.000Z' } }, AUJ), '2026-09-28');
});
