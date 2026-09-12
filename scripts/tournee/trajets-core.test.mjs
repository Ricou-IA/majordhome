// scripts/tournee/trajets-core.test.mjs
// Chargeur de matrice injectable (src/lib/tournee/trajets-core.js) : même
// algorithme que trajets.service.js, mais testable sans navigateur ni réseau.
// Run : node --test scripts/tournee/trajets-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerChargeurMatrice } from '../../src/lib/tournee/trajets-core.js';

/** Faux client supabase : `from('majordhome_travel_cache')` → select chaîné + upsert enregistrant. */
function fauxClient(lignesCache = []) {
  const upserts = [];
  return {
    upserts,
    from(table) {
      assert.equal(table, 'majordhome_travel_cache');
      const q = {
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        then(resolve) { resolve({ data: lignesCache, error: null }); },
        upsert(rows) { upserts.push(...rows); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  };
}
const A = { lat: 43.9, lng: 1.9 };   // "43.900,1.900"
const B = { lat: 43.6, lng: 2.24 };  // "43.600,2.240"
const silencieux = { error() {}, warn() {} };

test('cache chaud : aucun appel réseau, paires servies depuis le cache', async () => {
  let appels = 0;
  const charger = creerChargeurMatrice({
    client: fauxClient([
      { from_key: '43.900,1.900', to_key: '43.600,2.240', minutes: 35 },
      { from_key: '43.600,2.240', to_key: '43.900,1.900', minutes: 33 },
    ]),
    coreOrgId: 'org',
    token: 'tok',
    fetchImpl: async () => { appels += 1; throw new Error('non attendu'); },
    logger: silencieux,
  });
  const { data, estime, error } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(error, null);
  assert.equal(appels, 0);
  assert.equal(estime, false);
  assert.equal(data.get('43.900,1.900|43.600,2.240'), 35);
  assert.equal(data.get('43.600,2.240|43.900,1.900'), 33);
});

test('cache froid : Mapbox appelé, paires écrites dans le cache avec l org CORE', async () => {
  const client = fauxClient([]);
  const urls = [];
  const charger = creerChargeurMatrice({
    client,
    coreOrgId: 'org-core',
    token: 'tok',
    logger: silencieux,
    fetchImpl: async (url) => {
      urls.push(url);
      // Deux appels : noyau→candidats puis candidats→noyau ; chacun 1 source × 1 destination.
      return { ok: true, json: async () => ({ durations: [[2100]] }) };
    },
  });
  const { data, estime } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(estime, false);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes('access_token=tok')));
  assert.equal(data.get('43.900,1.900|43.600,2.240'), 35);
  assert.equal(data.get('43.600,2.240|43.900,1.900'), 35);
  assert.ok(client.upserts.some((r) => r.from_key === '43.900,1.900' && r.to_key === '43.600,2.240' && r.minutes === 35 && r.org_id === 'org-core'));
});

test('Mapbox KO : repli vol d oiseau, estime=true, jamais une exception', async () => {
  const charger = creerChargeurMatrice({
    client: fauxClient([]),
    coreOrgId: 'org',
    token: 'tok',
    fetchImpl: async () => { throw new Error('boom'); },
    logger: silencieux,
  });
  const { data, estime, error } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(error, null);
  assert.equal(estime, true);
  assert.ok(data.get('43.900,1.900|43.600,2.240') > 0);
});

test('token absent : aucun appel réseau, repli vol d oiseau signalé', async () => {
  let appels = 0;
  const charger = creerChargeurMatrice({
    client: fauxClient([]),
    coreOrgId: 'org',
    token: '',
    fetchImpl: async () => { appels += 1; return { ok: true, json: async () => ({ durations: [[0]] }) }; },
    logger: silencieux,
  });
  const { estime } = await charger({ noyau: [A], candidats: [B] });
  assert.equal(appels, 0);
  assert.equal(estime, true);
});

test('moins de deux points : matrice vide, sans appel ni erreur', async () => {
  const charger = creerChargeurMatrice({ client: fauxClient([]), coreOrgId: 'org', token: 'tok', fetchImpl: async () => { throw new Error('non attendu'); }, logger: silencieux });
  const { data, estime, error } = await charger({ noyau: [A], candidats: [] });
  assert.equal(error, null);
  assert.equal(estime, false);
  assert.equal(data.size, 0);
});
