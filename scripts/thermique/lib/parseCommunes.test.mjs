import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommunesTsv } from './parseCommunes.js';

const TSV = [
  'Villes\tINSEE\tPostal\tPopulation\tLatitude\tLongitude\tAltitude\tSuperficie\tDJU\tEntité\t\t',
  'Aast\t640001\t64460\t193\t43.29\t-0.09\t380\t475\t2 165\tCommune\t\t',
  'Abancourt\t590001\t59265\t442\t50.24\t3.21\t50\t567\t2 300\tCommune\t\t',
  '', // ligne vide finale
].join('\n');

test('parse le TSV villes : dept dérivé de INSEE, DJU avec espace insécable', () => {
  const rows = parseCommunesTsv(TSV);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    nom: 'Aast', insee: '640001', dept: '64', cp: '64460',
    lat: 43.29, lng: -0.09, altitude: 380, dju: 2165,
  });
  assert.equal(rows[1].dept, '59');
});
