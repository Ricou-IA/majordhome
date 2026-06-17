// scripts/sector-clustering.test.mjs
// Tests du clustering des secteurs (src/lib/sectorClustering.js).
// Run : node --test scripts/sector-clustering.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, clusterSectorsByProximity, normalizeCity } from '../src/lib/sectorClustering.js';

const contract = (city, lat, lng, status = 'pending') => ({
  id: `${city}-${lat}-${lng}-${Math.round((lat + lng) * 1e6)}`,
  client_city: city,
  client_latitude: lat,
  client_longitude: lng,
  current_year_visit_status: status,
});

// A=Gaillac, B=Marssac (~6 km de A), C=Albi (~32 km de A), D=Lacaune (isolé),
// E=sans coordonnées.
const buildSectors = () => ([
  { codePostal: '81600', commune: 'Gaillac', contracts: [
      contract('Gaillac', 43.90, 1.90), contract('Gaillac', 43.90, 1.90), contract('Gaillac', 43.901, 1.901) ] },
  { codePostal: '81150', commune: 'Marssac', contracts: [
      contract('Marssac-sur-Tarn', 43.90, 1.98), contract('Marssac-sur-Tarn', 43.901, 1.981) ] },
  { codePostal: '81000', commune: 'Albi', contracts: [
      contract('Albi', 43.90, 2.30), contract('Albi', 43.901, 2.301),
      contract('Albi', 43.902, 2.302), contract('Albi', 43.903, 2.303) ] },
  { codePostal: '81230', commune: 'Lacaune', contracts: [ contract('Lacaune', 43.70, 2.69) ] },
  { codePostal: '81999', commune: '', contracts: [
      { id: 'e1', client_city: '', client_latitude: null, client_longitude: null, current_year_visit_status: 'pending' },
      { id: 'e2', client_city: '', client_latitude: null, client_longitude: null, current_year_visit_status: 'pending' } ] },
]);

const cpsOf = (groups, name) => {
  const g = groups.find((x) => x.codePostals.includes(name));
  return g ? g.codePostals.slice().sort() : null;
};

test('haversineKm — points identiques = 0, ~8 km pour 0.1° de longitude à 43.9°', () => {
  assert.equal(haversineKm({ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 1.9 }), 0);
  const d = haversineKm({ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 2.0 });
  assert.ok(d > 7.8 && d < 8.2, `attendu ~8 km, obtenu ${d}`);
});

test('CP proches (≤ rayon) fusionnés en un seul grand secteur, nommé par commune dominante', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  assert.deepEqual(cpsOf(groups, '81600'), ['81150', '81600']);
  const g = groups.find((x) => x.codePostals.includes('81600'));
  assert.equal(g.name, 'Gaillac'); // 3 contrats Gaillac > 2 Marssac
});

test('CP éloigné = grand secteur singleton (jamais happé par un cluster lointain)', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  assert.deepEqual(cpsOf(groups, '81000'), ['81000']);
});

test('CP isolé géocodé = singleton (pas orphelin, pas dans Non localisé)', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const g = groups.find((x) => x.codePostals.includes('81230'));
  assert.deepEqual(g.codePostals, ['81230']);
  assert.notEqual(g.id, 'non-localise');
});

test('CP sans coordonnées = bucket Non localisé, placé en dernier', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const last = groups[groups.length - 1];
  assert.equal(last.id, 'non-localise');
  assert.deepEqual(last.codePostals, ['81999']);
});

test('conservation : chaque CP apparaît exactement une fois (ni perte, ni doublon)', () => {
  const sectors = buildSectors();
  const groups = clusterSectorsByProximity(sectors, { radiusKm: 15 });
  const allCps = groups.flatMap((g) => g.codePostals).sort();
  const inputCps = sectors.map((s) => s.codePostal).sort();
  assert.deepEqual(allCps, inputCps);
  assert.equal(new Set(allCps).size, allCps.length); // aucun doublon
});

test('déterminisme : l\'ordre d\'entrée ne change pas le regroupement', () => {
  const a = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const shuffled = buildSectors().reverse();
  const b = clusterSectorsByProximity(shuffled, { radiusKm: 15 });
  const norm = (gs) => gs.map((g) => g.codePostals.slice().sort().join(',')).sort();
  assert.deepEqual(norm(a), norm(b));
});

test('normalizeCity — accents + abréviations St/Ste', () => {
  assert.equal(normalizeCity('Le Séquestre'), 'le sequestre');
  assert.equal(normalizeCity('ST SULPICE LA POINTE'), 'saint sulpice la pointe');
  assert.equal(normalizeCity('Saint-Sulpice-la-Pointe'), 'saint sulpice la pointe');
});

test('nommage par taille de ville quand la population est fournie', () => {
  const sectors = [
    { codePostal: '81000', commune: 'Albi', contracts: [contract('Albi', 43.927, 2.159)] },
    { codePostal: '81990', commune: 'Le Séquestre', contracts: [
        contract('Le Séquestre', 43.908, 2.156),
        contract('Le Séquestre', 43.908, 2.156),
        contract('Le Séquestre', 43.909, 2.157) ] },
  ];
  // Le Séquestre a plus de contrats (3 vs 1) mais Albi est bien plus peuplée → "Albi"
  const pop = new Map([['albi', 51290], ['le sequestre', 2025]]);
  const groups = clusterSectorsByProximity(sectors, { radiusKm: 15, cityPopulation: pop });
  const g = groups.find((x) => x.codePostals.includes('81000'));
  assert.equal(g.name, 'Albi');
});
