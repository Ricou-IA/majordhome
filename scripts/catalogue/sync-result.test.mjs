// scripts/catalogue/sync-result.test.mjs
// Libellés du dernier relevé fournisseur (src/lib/catalogue/syncResult.js) — module PUR.
// Run : node --test scripts/catalogue/sync-result.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libelleResultat, libelleCodeErreur, CODES_ERREUR } from '../../src/lib/catalogue/syncResult.js';

const at = '2026-10-24T04:00:12.000Z';

test('relevé réussi : date, articles, nouveaux, désactivés', () => {
  const s = libelleResultat({ ok: true, at, total: 87, inseres: 2, mis_a_jour: 85, desactives: 1 });
  assert.match(s, /^Relevé du 24\/10\/2026/);
  assert.match(s, /87 articles/);
  assert.match(s, /2 nouveaux/);
  assert.match(s, /1 désactivé$/);
});

test('relevé réussi sans mouvement : pas de « 0 nouveau »', () => {
  const s = libelleResultat({ ok: true, at, total: 52, inseres: 0, mis_a_jour: 52, desactives: 0 });
  assert.match(s, /52 articles/);
  assert.doesNotMatch(s, /nouveau|désactivé/);
});

test('échec : chaque code a un libellé français et le libellé commence par « Échec »', () => {
  for (const code of CODES_ERREUR) {
    assert.ok(libelleCodeErreur(code).length > 10, code);
    assert.match(libelleResultat({ ok: false, code, at }), /^Échec du relevé du 24\/10\/2026 : /);
  }
  assert.match(libelleResultat({ ok: false, code: 'acces_bloque', at }), /BayWa a refusé la connexion serveur/);
  assert.match(libelleResultat({ ok: false, code: 'identifiants_absents', at }), /identifiant/);
  assert.match(libelleResultat({ ok: false, code: 'code_inconnu_xyz', at }), /code_inconnu_xyz/);
});

test('jamais relevé', () => {
  assert.equal(libelleResultat(null), 'Jamais relevé');
  assert.equal(libelleResultat(undefined), 'Jamais relevé');
  assert.equal(libelleResultat({}), 'Jamais relevé');
});
