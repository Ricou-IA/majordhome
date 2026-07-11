// scripts/cadastre-lib.test.mjs
// Tests des parsers purs cadastre/ABF (src/apps/solaire/lib/cadastre.js).
// Shapes issues des réponses réelles apicarto IGN (reconnaissance 2026-07-11).
// Run : node --test scripts/cadastre-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeParcelle,
  makeSquareAround,
  buildAbfSummary,
  toDbCadastre,
} from '../src/apps/solaire/lib/cadastre.js';

// Feature réelle apicarto /api/cadastre/parcelle (Gaillac, tronquée)
const PARCELLE_FEATURE = {
  type: 'Feature',
  id: 'parcelle.75990636',
  geometry: {
    type: 'MultiPolygon',
    coordinates: [[[[1.89313238, 43.9008625], [1.8935, 43.9008], [1.8933, 43.9012], [1.89313238, 43.9008625]]]],
  },
  properties: {
    gid: 75545079,
    numero: '0632',
    feuille: 1,
    section: 'BS',
    code_dep: '81',
    nom_com: 'Gaillac',
    code_com: '099',
    com_abs: '000',
    code_arr: '000',
    idu: '81099000BS0632',
    contenance: 4308,
    code_insee: '81099',
  },
};

test('normalizeParcelle — shape apicarto réelle → parcelle métier', () => {
  const p = normalizeParcelle(PARCELLE_FEATURE);
  assert.equal(p.idu, '81099000BS0632');
  assert.equal(p.prefixe, '000');
  assert.equal(p.section, 'BS');
  assert.equal(p.numero, '0632');
  assert.equal(p.code_insee, '81099');
  assert.equal(p.nom_com, 'Gaillac');
  assert.equal(p.superficie_m2, 4308);
  assert.equal(p.geometry.type, 'MultiPolygon');
});

test('normalizeParcelle — contenance absente → superficie_m2 null (pas 0 : inconnu ≠ nul)', () => {
  const f = { ...PARCELLE_FEATURE, properties: { ...PARCELLE_FEATURE.properties, contenance: undefined } };
  const p = normalizeParcelle(f);
  assert.equal(p.superficie_m2, null);
});

test('makeSquareAround — Polygon GeoJSON fermé de 5 points centré', () => {
  const sq = makeSquareAround(1.8939, 43.9008, 15);
  assert.equal(sq.type, 'Polygon');
  assert.equal(sq.coordinates.length, 1);
  const ring = sq.coordinates[0];
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]); // anneau fermé
  // demi-côté ≈ 15 m : dLat = 15/111320 ≈ 0.0001347
  const dLat = 15 / 111320;
  const lats = ring.map(([, lat]) => lat);
  assert.ok(Math.abs(Math.max(...lats) - (43.9008 + dLat)) < 1e-9);
  assert.ok(Math.abs(Math.min(...lats) - (43.9008 - dLat)) < 1e-9);
  // dLon corrigé du cos(lat) : plus large que dLat en degrés
  const dLon = 15 / (111320 * Math.cos((43.9008 * Math.PI) / 180));
  const lons = ring.map(([lon]) => lon);
  assert.ok(Math.abs(Math.max(...lons) - (1.8939 + dLon)) < 1e-9);
  assert.ok(dLon > dLat);
});

// Features réelles apicarto /api/gpu/assiette-sup-s (Gaillac centre : pm1 + ac1 + ac4)
const GPU_FEATURES = [
  { type: 'Feature', properties: { suptype: 'pm1', nomsuplitt: 'PPRN argiles', typeass: "Périmètre d'application" } },
  { type: 'Feature', properties: { suptype: 'ac1', nomsuplitt: 'PDA de Gaillac', typeass: 'Périmètre des abords' } },
  { type: 'Feature', properties: { suptype: 'ac4', nomsuplitt: 'Site patrimonial remarquable de Gaillac', typeass: 'Périmètre du SPR' } },
];

test('buildAbfSummary — filtre ac1/ac2/ac4, ignore pm1, checked_at posé', () => {
  const now = '2026-07-11T10:00:00.000Z';
  const abf = buildAbfSummary(GPU_FEATURES, now);
  assert.equal(abf.secteur_protege, true);
  assert.equal(abf.source, 'gpu');
  assert.equal(abf.checked_at, now);
  assert.equal(abf.protections.length, 2);
  assert.deepEqual(abf.protections[0], { suptype: 'ac1', nom: 'PDA de Gaillac', type: 'Périmètre des abords' });
  assert.deepEqual(abf.protections[1], {
    suptype: 'ac4',
    nom: 'Site patrimonial remarquable de Gaillac',
    type: 'Périmètre du SPR',
  });
});

test('buildAbfSummary — insensible à la casse du suptype', () => {
  const abf = buildAbfSummary([{ properties: { suptype: 'AC1', nomsuplitt: 'X', typeass: 'Y' } }], 'now');
  assert.equal(abf.secteur_protege, true);
  assert.equal(abf.protections[0].suptype, 'ac1');
});

test('buildAbfSummary — aucune feature → secteur_protege false, protections vides', () => {
  const abf = buildAbfSummary([], '2026-07-11T10:00:00.000Z');
  assert.equal(abf.secteur_protege, false);
  assert.deepEqual(abf.protections, []);
  assert.equal(abf.source, 'gpu');
});

test('toDbCadastre — shape DB de la migration (commune + parcelles + geojson)', () => {
  const p1 = normalizeParcelle(PARCELLE_FEATURE);
  const p2 = {
    ...p1,
    idu: '81099000BS0633',
    numero: '0633',
    superficie_m2: 120,
    geometry: { type: 'MultiPolygon', coordinates: [] },
  };
  const db = toDbCadastre([p1, p2]);
  assert.equal(db.commune_insee, '81099');
  assert.equal(db.nom_com, 'Gaillac');
  assert.deepEqual(db.parcelles, [
    { idu: '81099000BS0632', prefixe: '000', section: 'BS', numero: '0632', superficie_m2: 4308 },
    { idu: '81099000BS0633', prefixe: '000', section: 'BS', numero: '0633', superficie_m2: 120 },
  ]);
  // geojson = FeatureCollection des géométries sélectionnées (pour plan de masse tranche 3)
  assert.equal(db.geojson.type, 'FeatureCollection');
  assert.equal(db.geojson.features.length, 2);
  assert.equal(db.geojson.features[0].geometry.type, 'MultiPolygon');
  assert.equal(db.geojson.features[0].properties.idu, '81099000BS0632');
});

test('toDbCadastre — liste vide → null (bloc absent, pas un objet creux)', () => {
  assert.equal(toDbCadastre([]), null);
});
