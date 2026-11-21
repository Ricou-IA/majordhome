// Centres du territoire lus dans les réglages de l'organisation (settings.territoire_centers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centresValides, empreinteCentres, getOrgHeadquarters, getTerritoireCenters } from '../src/lib/territoire-config.js';

const deuxCentres = {
  siege: { lat: 43.9, lng: 1.87, label: 'Siège', color: '#f97316' },
  antenne: { lat: 43.71, lng: 1.45, label: 'Antenne', color: '#ef4444' },
};

test('centresValides : ordre des réglages, le premier est le siège, chaque entrée porte sa clé', () => {
  const c = centresValides(deuxCentres);
  assert.deepEqual(c.map((x) => x.key), ['siege', 'antenne']);
  assert.equal(c[0].label, 'Siège');
});

test('centresValides : un centre sans coordonnées est écarté, rien n\'est inventé', () => {
  assert.deepEqual(centresValides(null), []);
  assert.deepEqual(centresValides({}), []);
  assert.deepEqual(centresValides({ a: { label: 'Sans position' }, b: { lat: 1, lng: null } }), []);
  assert.deepEqual(centresValides({ a: { lat: '43.9', lng: 1.8 } }), []);
});

test('centresValides : une organisation à un seul centre a un siège et pas d\'antenne', () => {
  const [siege, ...antennes] = centresValides({ unique: { lat: 48.85, lng: 2.35 } });
  assert.equal(siege.key, 'unique');
  assert.equal(antennes.length, 0);
});

test('empreinteCentres : vide sans centre, change si un centre bouge, s\'ajoute ou change d\'ordre', () => {
  assert.equal(empreinteCentres(null), '');
  assert.equal(empreinteCentres({ a: { label: 'x' } }), '');
  const base = empreinteCentres(deuxCentres);
  assert.equal(base, empreinteCentres({ ...deuxCentres }));
  assert.notEqual(base, empreinteCentres({ ...deuxCentres, siege: { ...deuxCentres.siege, lat: 44 } }));
  assert.notEqual(base, empreinteCentres({ ...deuxCentres, autre: { lat: 44.1, lng: 2 } }));
  assert.notEqual(base, empreinteCentres({ antenne: deuxCentres.antenne, siege: deuxCentres.siege }));
});

test('empreinteCentres : la couleur ou le libellé ne recalculent pas les zones', () => {
  const base = empreinteCentres(deuxCentres);
  assert.equal(base, empreinteCentres({ ...deuxCentres, siege: { ...deuxCentres.siege, color: '#000', label: 'Autre nom' } }));
});

test('aucun centre par défaut : une organisation sans réglage n\'hérite de ceux de personne', () => {
  assert.deepEqual(getTerritoireCenters(null), {});
  assert.deepEqual(getTerritoireCenters({ territoire_centers: {} }), {});
  assert.equal(getOrgHeadquarters({}), null);
});
