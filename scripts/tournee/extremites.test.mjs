// scripts/tournee/extremites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resoudreExtremites, pointsDeJournee } from '../../src/lib/tournee/extremites.js';

const siege = { lat: 43.9, lng: 1.9, label: 'Gaillac' };
const maison = { label: 'Domicile', address: '1 rue X, 31620 Bouloc', lat: 43.78, lng: 1.41 };

test('sans réglage ni exception : agence aux deux bouts', () => {
  const r = resoudreExtremites({ siege, membre: {}, exception: null });
  assert.equal(r.depart.source, 'agence'); assert.equal(r.retour.source, 'agence');
  assert.equal(r.depart.label, 'Gaillac');
});
test('réglage personnel : départ et retour indépendants', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison, retour_point: null } });
  assert.equal(r.depart.source, 'perso'); assert.equal(r.depart.lat, 43.78);
  assert.equal(r.retour.source, 'agence');
});
test("exception 'agence' l'emporte sur le réglage", () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison, retour_point: maison }, exception: { depart: null, retour: 'agence' } });
  assert.equal(r.depart.source, 'perso'); assert.equal(r.retour.source, 'agence');
});
test("exception 'perso' sans point personnel : agence, sans erreur", () => {
  const r = resoudreExtremites({ siege, membre: {}, exception: { depart: 'perso', retour: 'perso' } });
  assert.equal(r.depart.source, 'agence');
});
test('point personnel invalide : repli siège', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: { lat: '', lng: 'abc' } } });
  assert.equal(r.depart.source, 'agence');
});
test('siège absent : point personnel seul, sinon null', () => {
  assert.equal(resoudreExtremites({ siege: null, membre: { depart_point: maison } }).depart.source, 'perso');
  assert.equal(resoudreExtremites({ siege: null, membre: {} }).depart, null);
});
test('libellé perso : label + commune', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: maison } });
  assert.equal(r.depart.label, 'Domicile (Bouloc)');
});
test('pointsDeJournee : retour = départ par défaut, siège en repli', () => {
  const p = pointsDeJournee({}, siege);
  assert.equal(p.depotKey, p.retourKey);
  const q = pointsDeJournee({ depart: { lat: 43.78, lng: 1.41 }, retour: { lat: 43.9, lng: 1.9 } }, siege);
  assert.notEqual(q.depotKey, q.retourKey);
  assert.equal(pointsDeJournee(null, null).depotKey, '');
});

test('libellé perso : commune extraite d une adresse Mapbox (« …, 31620 Bouloc, France »)', () => {
  const r = resoudreExtremites({ siege, membre: { depart_point: { ...maison, address: '1 Rue X, 31620 Bouloc, France' } } });
  assert.equal(r.depart.label, 'Domicile (Bouloc)');
});
