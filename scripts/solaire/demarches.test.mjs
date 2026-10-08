import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMARCHES_DEFAULTS, DELAIS_META, TARIFS_META, valeurA, buildDemarchesParams,
} from '../../src/apps/solaire/lib/demarches/parametres.js';

test('défauts : chaque délai et chaque tarif a ses métadonnées', () => {
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.delais)) assert.ok(DELAIS_META[cle], `DELAIS_META.${cle}`);
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.tarifs)) assert.ok(TARIFS_META[cle], `TARIFS_META.${cle}`);
  assert.deepEqual(DEMARCHES_DEFAULTS.prise_en_charge_defaut, { raccordement_enedis: 'refacture', consuel: 'refacture' });
});

test('valeurA : dernière entrée dont date_effet ≤ date cible', () => {
  const liste = [
    { date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' },
    { date_effet: '2026-10-28', valeur: 61 },
  ];
  assert.equal(valeurA(liste, '2026-10-27').valeur, 50.1);
  assert.equal(valeurA(liste, '2026-10-28').valeur, 61);
  assert.equal(valeurA(liste, '2026-10-28').perimee, false);
});

test('valeurA : périmée si valide_jusqu_au dépassé, null si rien en vigueur ou liste vide', () => {
  const liste = [{ date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' }];
  assert.equal(valeurA(liste, '2026-11-02').perimee, true);
  assert.equal(valeurA(liste, '2026-11-02').valeur, 50.1);
  assert.equal(valeurA(liste, '2025-12-31'), null);
  assert.equal(valeurA([], '2026-06-01'), null);
  assert.equal(valeurA(undefined, '2026-06-01'), null);
});

test('valeurA : ordre de la liste indifférent', () => {
  const liste = [{ date_effet: '2026-10-28', valeur: 61 }, { date_effet: '2026-01-01', valeur: 50.1 }];
  assert.equal(valeurA(liste, '2026-06-01').valeur, 50.1);
});

test('buildDemarchesParams : les objets fusionnent, les listes datées remplacent', () => {
  const settings = { pv: { demarches: {
    delais: { consuel: { jours: 10 } },
    tarifs: { tarif_consuel_bleu: [{ date_effet: '2027-01-01', valeur: 200 }] },
  } } };
  const p = buildDemarchesParams(settings);
  assert.equal(p.delais.consuel.jours, 10);
  assert.equal(p.delais.recours_tiers.mois, 2);            // défaut conservé
  assert.deepEqual(p.tarifs.tarif_consuel_bleu, [{ date_effet: '2027-01-01', valeur: 200 }]);
  assert.equal(p.tarifs.frais_raccordement_enedis.length, 1); // défaut conservé
});

test('buildDemarchesParams : sans settings → défauts', () => {
  assert.deepEqual(buildDemarchesParams(undefined), DEMARCHES_DEFAULTS);
  assert.deepEqual(buildDemarchesParams({}), DEMARCHES_DEFAULTS);
});
