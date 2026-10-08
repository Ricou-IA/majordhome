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

// ── Task 2 : planning ──────────────────────────────────────────────────────
import { ajouterDelai, lundiSuivant, maxIso, calculerPlanning } from '../../src/apps/solaire/lib/demarches/planning.js';

test('ajouterDelai : jours et mois calendaires, écrêtage fin de mois', () => {
  assert.equal(ajouterDelai('2026-10-08', { jours: 7 }), '2026-10-15');
  assert.equal(ajouterDelai('2026-01-31', { mois: 1 }), '2026-02-28');
  assert.equal(ajouterDelai('2026-11-15', { mois: 2 }), '2027-01-15');
  assert.equal(ajouterDelai('2026-10-08', {}), '2026-10-08');
});

test('lundiSuivant : lundi conservé, sinon prochain lundi', () => {
  assert.equal(lundiSuivant('2026-10-12'), '2026-10-12'); // lundi
  assert.equal(lundiSuivant('2026-10-13'), '2026-10-19'); // mardi
  assert.equal(lundiSuivant('2026-10-11'), '2026-10-12'); // dimanche
});

test('maxIso', () => {
  assert.equal(maxIso('2026-01-01', '2026-03-01'), '2026-03-01');
  assert.equal(maxIso('2026-03-01', '2026-01-01'), '2026-03-01');
});

test('calculerPlanning : chevauchement recours / Enedis, pose au lundi suivant le max', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp', enedisCle: 'enedis_surplus' }, DEMARCHES_DEFAULTS);
  assert.equal(p.depot_dp, '2026-10-15');
  assert.equal(p.accord_dp, '2026-11-15');
  assert.equal(p.fin_recours, '2027-01-15');
  assert.equal(p.depot_enedis, '2026-11-15');       // = accord, en parallèle du recours
  assert.equal(p.reponse_enedis, '2027-02-15');     // 3 mois (surplus) > fin du recours
  assert.equal(p.pose_au_plus_tot, '2027-02-15');   // 15/02/2027 est un lundi
  assert.equal(p.fin_pose, '2027-02-17');
  assert.equal(p.attestation_consuel, '2027-03-10');
  assert.equal(p.mise_en_service_au_plus_tard, '2027-04-21');
  assert.equal(p.duree_totale_mois, 6.4);
  assert.ok(p.hypotheses.some((h) => h.includes('7 jours')));
});

test('calculerPlanning : ABF = 2 mois d’instruction ; CACSI = 2 mois Enedis, le recours devient le facteur limitant', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp_abf', enedisCle: 'enedis_cacsi' }, DEMARCHES_DEFAULTS);
  assert.equal(p.accord_dp, '2026-12-15');
  assert.equal(p.fin_recours, '2027-02-15');
  assert.equal(p.reponse_enedis, '2027-02-15');
  assert.equal(p.pose_au_plus_tot, '2027-02-15');
});
