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

test('annule les valeurs hors bornes (colonnes décalées dans la source)', () => {
  // Lignes inspirées de Racquinghem (lng/altitude reçoivent code INSEE et CP décalés)
  // et Westhoffen (lat=1597).
  const tsv = [
    'Villes\tINSEE\tPostal\tPopulation\tLatitude\tLongitude\tAltitude\tSuperficie\tDJU\tEntité\t\t',
    'Décalée\t620684\t62120\t2154\t50.69\t62684\t62120\t506\t7148\tCommune\t\t',
    'Latitude-KO\t670525\t67310\t1597\t1597\t48.6\t7.44333\t1000\t3 632\tCommune\t\t',
  ].join('\n');
  const rows = parseCommunesTsv(tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].lat, 50.69); // dans les bornes : conservée
  assert.equal(rows[0].lng, null); // 62684 hors [-64, 56]
  assert.equal(rows[0].altitude, null); // 62120 hors [-10, 4900]
  assert.equal(rows[1].lat, null); // 1597 hors [-22, 52]
  assert.equal(rows[1].lng, 48.6);
  assert.equal(rows[1].altitude, 7.44333); // dans les bornes : valeur conservée telle quelle
});

test('DJU vide -> null', () => {
  const tsv = [
    'Villes\tINSEE\tPostal\tPopulation\tLatitude\tLongitude\tAltitude\tSuperficie\tDJU\tEntité\t\t',
    'Sans-DJU\t830002\t83630\t273\t43.78\t6.24\t800\t11430\t\tCommune\t\t',
  ].join('\n');
  const rows = parseCommunesTsv(tsv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dju, null);
});
