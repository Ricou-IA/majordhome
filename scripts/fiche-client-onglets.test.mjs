// scripts/fiche-client-onglets.test.mjs — onglets de la fiche client (refonte UI phase 3)
// node --test scripts/fiche-client-onglets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONGLETS, LIBELLE_ONGLET, ongletDeDepart, ongletActif } from '../src/lib/ficheClientOnglets.js';

test('six onglets, dans l’ordre, chacun avec son libellé', () => {
  assert.deepEqual(ONGLETS, ['resume', 'contrat', 'equipements', 'interventions', 'devis-factures', 'echanges']);
  assert.deepEqual(ONGLETS.map((id) => LIBELLE_ONGLET[id]), [
    'Résumé', 'Contrat', 'Équipements', 'Interventions', 'Devis et factures', 'Échanges',
  ]);
});

test('chaque ancien identifiant d’onglet mène au nouvel onglet qui le contient', () => {
  const attendus = {
    info: 'resume',
    contract: 'contrat',
    equipments: 'equipements',
    interventions: 'interventions',
    'devis-pl': 'devis-factures',
    'factures-pl': 'devis-factures',
    timeline: 'echanges',
    mailings: 'echanges',
    sms: 'echanges',
  };
  for (const [ancien, nouveau] of Object.entries(attendus)) {
    assert.equal(ongletDeDepart(ancien), nouveau, ancien);
  }
});

test('un nouvel identifiant est gardé tel quel', () => {
  for (const id of ONGLETS) assert.equal(ongletDeDepart(id), id);
});

test('absent ou inconnu : Résumé', () => {
  assert.equal(ongletDeDepart(undefined), 'resume');
  assert.equal(ongletDeDepart(null), 'resume');
  assert.equal(ongletDeDepart(''), 'resume');
  assert.equal(ongletDeDepart('xyz'), 'resume');
  assert.equal(ongletDeDepart('constructor'), 'resume', 'pas de propriété héritée d’Object');
});

test('ongletActif : l’URL prime sur l’état de navigation, Résumé par défaut', () => {
  assert.equal(ongletActif({ url: 'devis-factures', etat: 'contract' }), 'devis-factures');
  assert.equal(ongletActif({ url: 'timeline' }), 'echanges');
  assert.equal(ongletActif({ url: null, etat: 'contract' }), 'contrat');
  assert.equal(ongletActif({}), 'resume');
  assert.equal(ongletActif({ url: 'nimporte' }), 'resume');
});
