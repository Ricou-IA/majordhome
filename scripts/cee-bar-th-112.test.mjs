// scripts/cee-bar-th-112.test.mjs
// Verdict CEE BAR-TH-112 d'un poêle (src/lib/cee/barTh112.js) — seuils de la fiche A46.3 lue le 2026-11-28.
// Run : node --test scripts/cee-bar-th-112.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictBarTh112, SEUILS_BAR_TH_112 } from '../src/lib/cee/barTh112.js';

const toron = { fuel_type: 'bois', etas_pct: 67, pm_mg_nm3: 30, cog_mgc_nm3: 100, co_mg_nm3: 1250, nox_mg_nm3: 160, norme_mesure: 'EN 13240' };

test('seuils de la fiche', () => {
  assert.deepEqual(SEUILS_BAR_TH_112.bois, { etas_min: 66, pm_max: 40, cog_max: 120, co_max: 1500, nox_max: 200 });
  assert.deepEqual(SEUILS_BAR_TH_112.granules, { etas_min: 80, pm_max: 20, cog_max: 60, co_max: 300, nox_max: 200 });
});

test('bûches complet sous les seuils : conforme', () => {
  assert.deepEqual(verdictBarTh112(toron), { statut: 'conforme', manquants: [], depassements: [], remarques: [] });
});

test('valeur au seuil exact : conforme', () => {
  assert.equal(verdictBarTh112({ ...toron, etas_pct: 66, pm_mg_nm3: 40, co_mg_nm3: 1500 }).statut, 'conforme');
});

test('particules au-dessus : hors seuil, détail', () => {
  const v = verdictBarTh112({ ...toron, pm_mg_nm3: 45 });
  assert.equal(v.statut, 'hors_seuil');
  assert.deepEqual(v.depassements, [{ cle: 'pm_mg_nm3', valeur: 45, seuil: 40 }]);
});

test('granulés : seuils propres (Etas 79 hors seuil)', () => {
  const v = verdictBarTh112({ ...toron, fuel_type: 'granules', etas_pct: 79, pm_mg_nm3: 15, cog_mgc_nm3: 50, co_mg_nm3: 200 });
  assert.equal(v.statut, 'hors_seuil');
  assert.deepEqual(v.depassements, [{ cle: 'etas_pct', valeur: 79, seuil: 80 }]);
});

test('NOx manquant : incomplet', () => {
  const { nox_mg_nm3, ...sans } = toron; // eslint-disable-line no-unused-vars
  assert.deepEqual(verdictBarTh112(sans), { statut: 'incomplet', manquants: ['nox_mg_nm3'], depassements: [], remarques: [] });
});

test('norme absente : incomplet', () => {
  const { norme_mesure, ...sans } = toron; // eslint-disable-line no-unused-vars
  assert.deepEqual(verdictBarTh112(sans).manquants, ['norme_mesure']);
});

test('Flamme Verte : émissions non exigées', () => {
  assert.equal(verdictBarTh112({ fuel_type: 'bois', etas_pct: 70, norme_mesure: 'EN 13240', flamme_verte: true }).statut, 'conforme');
});

test('Flamme Verte : réputé satisfaire les émissions, une valeur saisie n’est pas jugée', () => {
  assert.equal(verdictBarTh112({ ...toron, flamme_verte: true, pm_mg_nm3: 45 }).statut, 'conforme');
});

test('hors seuil prime sur incomplet', () => {
  const v = verdictBarTh112({ fuel_type: 'bois', etas_pct: 60 });
  assert.equal(v.statut, 'hors_seuil');
  assert.ok(v.manquants.includes('pm_mg_nm3'));
});

test('combustible hybride, absent ou canonical nul : inconnu', () => {
  for (const c of [{ ...toron, fuel_type: 'hybride' }, { ...toron, fuel_type: undefined }, null, undefined]) {
    assert.equal(verdictBarTh112(c).statut, 'inconnu');
  }
});

test('valeur non numérique traitée comme manquante', () => {
  const v = verdictBarTh112({ ...toron, co_mg_nm3: 'n.c.' });
  assert.equal(v.statut, 'incomplet');
  assert.ok(v.manquants.includes('co_mg_nm3'));
});

test('EN 16510-1 : remarque obligé', () => {
  assert.deepEqual(verdictBarTh112({ ...toron, norme_mesure: 'EN 16510-1' }).remarques, ['norme EN 16510-1 : à faire accepter par l\'obligé']);
});

test('norme « Autre » : non citée par la fiche, remarque obligé (jamais un conforme sans réserve)', () => {
  const v = verdictBarTh112({ ...toron, norme_mesure: 'Autre' });
  assert.deepEqual(v.remarques, ['norme non citée par la fiche : à faire accepter par l’obligé']);
});
