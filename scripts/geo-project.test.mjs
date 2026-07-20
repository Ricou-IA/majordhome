// scripts/geo-project.test.mjs
// Tests de la projection géo pure des pièces graphiques DP (src/apps/solaire/lib/geoProject.js).
// Run : node --test scripts/geo-project.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lonLatToWorld, worldToLonLat, computeBbox, mapboxStaticBbox, fitZoom,
  makeProjector, metricScale, bboxWidthMeters, polygonToRings, ringsToSvgPath,
} from '../src/apps/solaire/lib/geoProject.js';

// Carré ~100 m de côté autour de Gaillac (43.90 N)
const LON = 1.897;
const LAT = 43.901;
const D_LAT = 100 / 111320;
const D_LON = 100 / (111320 * Math.cos((LAT * Math.PI) / 180));
const SQUARE = {
  type: 'Polygon',
  coordinates: [[
    [LON, LAT], [LON + D_LON, LAT], [LON + D_LON, LAT + D_LAT], [LON, LAT + D_LAT], [LON, LAT],
  ]],
};

test('lonLatToWorld ↔ worldToLonLat — aller-retour stable', () => {
  const w = lonLatToWorld(LON, LAT, 15);
  const back = worldToLonLat(w.x, w.y, 15);
  assert.ok(Math.abs(back.lon - LON) < 1e-9);
  assert.ok(Math.abs(back.lat - LAT) < 1e-9);
});

test('computeBbox — englobe les features avec marge, null si vide', () => {
  const bbox = computeBbox([{ type: 'Feature', geometry: SQUARE }], 0.1);
  assert.ok(bbox.minLon < LON && bbox.maxLon > LON + D_LON);
  assert.ok(bbox.minLat < LAT && bbox.maxLat > LAT + D_LAT);
  assert.equal(computeBbox([], 0.1), null);
  assert.equal(computeBbox([{ geometry: null }]), null);
});

test('mapboxStaticBbox — largeur métrique ≈ résolution du zoom × largeur px', () => {
  const zoom = 18;
  const wPx = 1000;
  const bbox = mapboxStaticBbox(LON, LAT, zoom, wPx, 600);
  // Résolution Web Mercator (tuiles 512) : 40075016.686 × cos(lat) / (512 × 2^z) m/px
  const expected = ((40075016.686 * Math.cos((LAT * Math.PI) / 180)) / (512 * 2 ** zoom)) * wPx;
  const actual = bboxWidthMeters(bbox);
  assert.ok(Math.abs(actual - expected) / expected < 0.01, `${actual} vs ${expected}`);
});

test('fitZoom — la bbox tient dans l’image au zoom retourné, pas au zoom+1', () => {
  const bbox = computeBbox([SQUARE], 0.1);
  const z = fitZoom(bbox, 1000, 600, 22);
  const cover = mapboxStaticBbox((bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2, z, 1000, 600);
  assert.ok(cover.minLon <= bbox.minLon && cover.maxLon >= bbox.maxLon);
  assert.ok(cover.minLat <= bbox.minLat && cover.maxLat >= bbox.maxLat);
  const coverTight = mapboxStaticBbox((bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2, z + 1, 1000, 600);
  const fitsTight = coverTight.minLon <= bbox.minLon && coverTight.maxLon >= bbox.maxLon
    && coverTight.minLat <= bbox.minLat && coverTight.maxLat >= bbox.maxLat;
  assert.equal(fitsTight, false);
  // borne maxZoom respectée
  assert.ok(fitZoom(bbox, 1000, 600, 17) <= 17);
});

test('makeProjector — carré géographique → carré PDF proportionné, y vers le bas', () => {
  const bbox = computeBbox([SQUARE], 0);
  const project = makeProjector(bbox, 400, 400);
  const p00 = project(LON, LAT); // coin SW → bas-gauche
  const p10 = project(LON + D_LON, LAT); // SE
  const p01 = project(LON, LAT + D_LAT); // NW → haut-gauche
  const width = p10.x - p00.x;
  const height = p00.y - p01.y; // y augmente vers le bas
  assert.ok(width > 0 && height > 0);
  assert.ok(Math.abs(width - height) / width < 0.01, `ratio non préservé : ${width}×${height}`);
  assert.ok(p01.y < p00.y, 'le nord doit être en haut');
});

test('metricScale — barre « ronde » 1/2/5×10ⁿ visant ~1/4 de largeur', () => {
  const bbox = mapboxStaticBbox(LON, LAT, 18, 1000, 600); // ~ 275 m de large
  const scale = metricScale(bbox, 700);
  assert.ok([1, 2, 5].includes(scale.meters / 10 ** Math.floor(Math.log10(scale.meters))));
  assert.ok(scale.lengthPt > 0 && scale.lengthPt <= 700 / 2);
  assert.match(scale.label, /^\d+ m$/);
});

test('polygonToRings + ringsToSvgPath — anneaux projetés → path SVG fermé', () => {
  const bbox = computeBbox([SQUARE], 0.1);
  const project = makeProjector(bbox, 400, 300);
  const rings = polygonToRings(SQUARE, project);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  const d = ringsToSvgPath(rings);
  assert.match(d, /^M .+ Z$/);
  // MultiPolygon → un sous-chemin par anneau
  const multi = { type: 'MultiPolygon', coordinates: [SQUARE.coordinates, SQUARE.coordinates] };
  assert.equal(polygonToRings(multi, project).length, 2);
  assert.equal(polygonToRings(null, project).length, 0);
});
