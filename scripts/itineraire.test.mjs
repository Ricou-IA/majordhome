// scripts/itineraire.test.mjs — liens d'itinéraire (src/lib/itineraire.js)
// node --test scripts/itineraire.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formaterAdresse, lienGoogleMaps, lienWaze } from '../src/lib/itineraire.js';

test('formaterAdresse : une ligne, sans séparateur orphelin', () => {
  assert.equal(formaterAdresse({ address: '12 rue des Lilas', postalCode: '81600', city: 'Gaillac' }), '12 rue des Lilas, 81600 Gaillac');
  assert.equal(formaterAdresse({ address: '12 rue des Lilas' }), '12 rue des Lilas');
  assert.equal(formaterAdresse({ city: 'Gaillac' }), 'Gaillac');
  assert.equal(formaterAdresse({}), '');
});

test('les coordonnées géocodées priment sur le texte', () => {
  const dest = { adresse: '12 rue des Lilas, 81600 Gaillac', lat: 43.9014, lng: 1.8969 };
  assert.equal(lienGoogleMaps(dest), 'https://www.google.com/maps/dir/?api=1&destination=43.9014%2C1.8969&travelmode=driving');
  assert.equal(lienWaze(dest), 'https://waze.com/ul?ll=43.9014,1.8969&navigate=yes');
});

test("sans coordonnées, l'adresse est encodée", () => {
  const dest = { adresse: '12 rue des Lilas, 81600 Gaillac', lat: null, lng: null };
  assert.equal(lienGoogleMaps(dest), 'https://www.google.com/maps/dir/?api=1&destination=12%20rue%20des%20Lilas%2C%2081600%20Gaillac&travelmode=driving');
  assert.equal(lienWaze(dest), 'https://waze.com/ul?q=12%20rue%20des%20Lilas%2C%2081600%20Gaillac&navigate=yes');
});

test('coordonnées 0,0 ou invalides = non géocodé', () => {
  assert.match(lienGoogleMaps({ adresse: 'Gaillac', lat: 0, lng: 0 }), /destination=Gaillac/);
  assert.match(lienWaze({ adresse: 'Gaillac', lat: 'abc', lng: 1 }), /q=Gaillac/);
});

test('rien à viser → null, le composant ne rend pas de lien', () => {
  assert.equal(lienGoogleMaps({ adresse: '  ' }), null);
  assert.equal(lienWaze({}), null);
});
