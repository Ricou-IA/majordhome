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

test('dureeTerritoire : le réglage de l\'organisation s\'il est proposé, sinon une heure', async () => {
  const { dureeTerritoire, DUREES_TERRITOIRE } = await import('../src/lib/territoire-config.js');
  assert.equal(dureeTerritoire(null), 60);
  assert.equal(dureeTerritoire({}), 60);
  assert.equal(dureeTerritoire({ territoire_minutes: 30 }), 30);
  assert.equal(dureeTerritoire({ territoire_minutes: '45' }), 45);
  assert.equal(dureeTerritoire({ territoire_minutes: 90 }), 60); // au-delà du maximum de l'API
  assert.equal(dureeTerritoire({ territoire_minutes: 0 }), 60);
  assert.ok(DUREES_TERRITOIRE.every((m) => m <= 60));
});

test('empreinteCentres : l\'étendue recalcule les zones, l\'étendue par défaut garde celles déjà calculées', () => {
  const base = empreinteCentres(deuxCentres);
  assert.equal(empreinteCentres(deuxCentres, 60), base);
  assert.notEqual(empreinteCentres(deuxCentres, 30), base);
  assert.notEqual(empreinteCentres(deuxCentres, 30), empreinteCentres(deuxCentres, 45));
  assert.equal(empreinteCentres(null, 30), '');
});

test('dureeDuCentre : l\'étendue du centre, sinon le repli ; l\'empreinte suit chaque centre', async () => {
  const { dureeDuCentre } = await import('../src/lib/territoire-config.js');
  assert.equal(dureeDuCentre({ minutes: 20 }), 20);
  assert.equal(dureeDuCentre({ minutes: '45' }, 30), 45);
  assert.equal(dureeDuCentre({}, 30), 30);
  assert.equal(dureeDuCentre({ minutes: 90 }, 30), 30);
  assert.equal(dureeDuCentre(null), 60);

  const base = empreinteCentres(deuxCentres);
  const antenneCourte = { ...deuxCentres, antenne: { ...deuxCentres.antenne, minutes: 20 } };
  assert.notEqual(empreinteCentres(antenneCourte), base);
  // un centre à une heure explicite = l'empreinte d'avant le réglage
  assert.equal(empreinteCentres({ ...deuxCentres, siege: { ...deuxCentres.siege, minutes: 60 } }), base);
  // l'étendue propre d'un centre prime sur le repli commun
  assert.equal(
    empreinteCentres({ siege: { ...deuxCentres.siege, minutes: 60 }, antenne: { ...deuxCentres.antenne, minutes: 60 } }, 30),
    base,
  );
});

test('demiPlanProche : le côté du centre le plus proche, borné par la médiatrice', async () => {
  const { demiPlanProche } = await import('../src/lib/territoire-config.js');
  const siege = { lat: 43.9, lng: 1.9 };
  const antenne = { lat: 43.7, lng: 1.45 };
  const dedans = (poly, [x, y]) => { // point dans un polygone convexe (anneau fermé)
    const a = poly.geometry.coordinates[0];
    let signe = 0;
    for (let i = 0; i < a.length - 1; i++) {
      const v = (a[i + 1][0] - a[i][0]) * (y - a[i][1]) - (a[i + 1][1] - a[i][1]) * (x - a[i][0]);
      if (v !== 0) { if (signe && Math.sign(v) !== signe) return false; signe = Math.sign(v); }
    }
    return true;
  };
  const cote = demiPlanProche(siege, antenne);
  assert.equal(cote.geometry.type, 'Polygon');
  assert.equal(dedans(cote, [antenne.lng, antenne.lat]), true);
  assert.equal(dedans(cote, [siege.lng, siege.lat]), false);
  // un point tout près de l'antenne, un point tout près du siège
  assert.equal(dedans(cote, [1.5, 43.72]), true);
  assert.equal(dedans(cote, [1.85, 43.88]), false);
  // les deux côtés se partagent le plan : le milieu est sur la frontière, chacun a son centre
  const autreCote = demiPlanProche(antenne, siege);
  assert.equal(dedans(autreCote, [siege.lng, siege.lat]), true);
  assert.equal(dedans(autreCote, [antenne.lng, antenne.lat]), false);
  // deux centres au même endroit : pas de partage possible
  assert.equal(demiPlanProche(siege, siege), null);
});

test('interventionDuCentre : le siège intervient toujours, une antenne seulement si on le règle', async () => {
  const { interventionDuCentre } = await import('../src/lib/territoire-config.js');
  // sans réglage : le siège intervient aussi loin que son commercial, l'antenne pas du tout
  assert.equal(interventionDuCentre({}, true), 60);
  assert.equal(interventionDuCentre({ minutes: 30 }, true), 30);
  assert.equal(interventionDuCentre({ minutes: 45 }, false), 0);
  assert.equal(interventionDuCentre(null, false), 0);
  // réglé
  assert.equal(interventionDuCentre({ minutes: 60, intervention_minutes: 30 }, true), 30);
  assert.equal(interventionDuCentre({ intervention_minutes: 60 }, false), 60);
  assert.equal(interventionDuCentre({ intervention_minutes: 0 }, false), 0);
  assert.equal(interventionDuCentre({ intervention_minutes: '45' }, false), 45);
  // un siège sans intervention n'a pas de sens : son périmètre commercial fait foi
  assert.equal(interventionDuCentre({ minutes: 45, intervention_minutes: 0 }, true), 45);
  // valeur hors liste : comme sans réglage
  assert.equal(interventionDuCentre({ intervention_minutes: 90 }, false), 0);

  // l'empreinte suit le périmètre d'intervention
  const base = empreinteCentres(deuxCentres);
  assert.notEqual(empreinteCentres({ ...deuxCentres, antenne: { ...deuxCentres.antenne, intervention_minutes: 60 } }), base);
  assert.equal(empreinteCentres({ ...deuxCentres, antenne: { ...deuxCentres.antenne, intervention_minutes: 0 } }), base);
});

test('zoneDuPoint : zone du commercial, hors zone hors du périmètre où l’entreprise intervient, inconnue sinon', async () => {
  const { zoneDuPoint, ZONE_HORS, estHorsZone } = await import('../src/lib/territoire-config.js');
  const zones = { ordre: ['siege', 'antenne'], zones: { siege: 'S', antenne: 'A' }, zone_principale: 'P' };
  const dans = (...noms) => (zone) => noms.includes(zone);
  assert.equal(zoneDuPoint(zones, dans('S', 'P')), 'siege');
  assert.equal(zoneDuPoint(zones, dans('A', 'P')), 'antenne');
  assert.equal(zoneDuPoint(zones, dans('A', 'S', 'P')), 'antenne'); // l'antenne d'abord
  // dans le périmètre d'intervention mais chez aucun commercial : ni zone, ni hors zone
  assert.equal(zoneDuPoint(zones, dans('P')), null);
  assert.equal(zoneDuPoint(zones, dans()), ZONE_HORS);
  // hors du périmètre mais dans le contour lissé d'une zone commerciale : hors zone quand même
  assert.equal(zoneDuPoint(zones, dans('A')), ZONE_HORS);
  // zones inconnues : on ne dit jamais « hors zone »
  assert.equal(zoneDuPoint(null, dans()), null);
  assert.equal(zoneDuPoint({}, dans()), null);
  assert.equal(estHorsZone({ zone: ZONE_HORS }), true);
  assert.equal(estHorsZone({ zone: 'siege' }), false);
  assert.equal(estHorsZone({ zone: null }), false);
  assert.equal(estHorsZone(null), false);
});
