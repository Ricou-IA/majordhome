import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arretsDeLaJournee, pointsItineraire, urlDirections, lireDirections, estimerTroncons,
  lienGoogleMapsTournee, urlCarteStatique, buildFeuilleDeRoute, formatDureeRoute, formatKm,
  decoderPolyline,
} from '../src/lib/feuilleDeRoute.js';

const MOH = 'tm-moh';
const depot = { lat: 43.9, lng: 1.9, label: 'Siège Gaillac' };

const rdv = (over) => ({
  id: 'a1', appointment_type: 'maintenance', status: 'scheduled',
  scheduled_date: '2026-10-26', scheduled_start: '08:00:00', scheduled_end: '09:00:00',
  technician_ids: [MOH], client_id: 'c1', client_name: 'THUILAND', client_first_name: 'Martine',
  address: '3 rue du Château', postal_code: '81120', city: 'Labastide-Dénat',
  client_phone: '0665556460', lat: 43.86, lng: 2.19,
  ...over,
});

test('arretsDeLaJournee : la personne seule, ordre horaire, sans congés ni annulés, dédupliqué', () => {
  const rows = [
    rdv({ id: 'b', scheduled_start: '11:30:00' }),
    rdv({ id: 'a', scheduled_start: '08:00:00' }),
    rdv({ id: 'a', scheduled_start: '08:00:00' }),
    rdv({ id: 'autre', technician_ids: ['tm-lucas'] }),
    rdv({ id: 'conges', appointment_type: 'leave' }),
    rdv({ id: 'annule', status: 'cancelled' }),
    rdv({ id: 'vt', technician_ids: [], assigned_commercial_id: MOH, scheduled_start: '14:00:00' }),
  ];
  assert.deepEqual(arretsDeLaJournee(rows, [MOH]).map((r) => r.id), ['a', 'b', 'vt']);
});

test('pointsItineraire : dépôt → arrêts localisés → dépôt ; vide sans dépôt', () => {
  const arrets = [rdv({ id: 'a' }), rdv({ id: 'x', lat: null, lng: null }), rdv({ id: 'b', lat: 43.7, lng: 1.6 })];
  const pts = pointsItineraire(depot, arrets);
  assert.equal(pts.length, 4);
  assert.equal(pts[0].rdvId, null);
  assert.deepEqual(pts.slice(1, 3).map((p) => p.rdvId), ['a', 'b']);
  assert.equal(pts[3].rdvId, null);
  assert.deepEqual(pointsItineraire(null, arrets), []);
  assert.deepEqual(pointsItineraire(depot, [rdv({ lat: null, lng: null })]), []);
});

test('urlDirections : lng,lat dans l\'ordre, null sans token ni points', () => {
  const pts = pointsItineraire(depot, [rdv()]);
  const url = urlDirections(pts, 'tok');
  assert.match(url, /driving\/1\.9,43\.9;2\.19,43\.86;1\.9,43\.9\?/);
  assert.equal(urlDirections(pts, ''), null);
  assert.equal(urlDirections([], 'tok'), null);
});

test('lireDirections : tronçons en minutes/km ; null si nombre de legs incohérent', () => {
  const json = { routes: [{ geometry: 'abc', legs: [{ duration: 1800, distance: 25400 }, { duration: 1500, distance: 20000 }] }] };
  assert.deepEqual(lireDirections(json, 3), { troncons: [{ minutes: 30, km: 25.4 }, { minutes: 25, km: 20 }], geometry: 'abc' });
  assert.equal(lireDirections(json, 4), null);
  assert.equal(lireDirections({}, 3), null);
});

test('estimerTroncons : un tronçon par paire, durée > 0', () => {
  const t = estimerTroncons(pointsItineraire(depot, [rdv()]));
  assert.equal(t.length, 2);
  assert.ok(t[0].minutes > 0 && t[0].km > 0);
});

test('lienGoogleMapsTournee : coordonnées si localisé, adresse sinon', () => {
  const url = lienGoogleMapsTournee(depot, [rdv(), rdv({ id: 'x', lat: null, lng: null, address: '1 rue A', postal_code: '81600', city: 'Gaillac' })]);
  assert.match(url, /origin=43\.9%2C1\.9&destination=43\.9%2C1\.9/);
  assert.match(url, /waypoints=43\.86%2C2\.19%7C1%20rue%20A%2081600%20Gaillac/);
  assert.equal(lienGoogleMapsTournee(null, [rdv()]), null);
});

test('urlCarteStatique : un repère numéroté par arrêt + dépôt, tracé encodé', () => {
  const pts = pointsItineraire(depot, [rdv({ id: 'a' }), rdv({ id: 'b', lat: 43.7, lng: 1.6 })]);
  const url = urlCarteStatique({ points: pts, geometry: 'a?b', token: 'tok' });
  assert.match(url, /path-4\+2563EB-0\.75\(a%3Fb\)/);
  assert.match(url, /pin-s-home\+334155\(1\.90000,43\.90000\)/);
  assert.match(url, /pin-s-1\+2563EB\(2\.19000,43\.86000\)/);
  assert.match(url, /pin-s-2\+2563EB\(1\.60000,43\.70000\)/);
  assert.doesNotMatch(url, /pin-s-3/);
  assert.equal(urlCarteStatique({ points: pts, token: '' }), null);
});

test('buildFeuilleDeRoute : trajet avant chaque arrêt localisé, retour, totaux, non localisé signalé', () => {
  const arrets = [rdv({ id: 'a' }), rdv({ id: 'x', lat: null, lng: null, scheduled_start: '10:00:00' }), rdv({ id: 'b', lat: 43.7, lng: 1.6, scheduled_start: '11:30:00' })];
  const troncons = [{ minutes: 30, km: 25 }, { minutes: 20, km: 15 }, { minutes: 10, km: 8.4 }];
  const m = buildFeuilleDeRoute({
    date: '2026-10-26', person: { displayName: 'Mohammed', color: '#22C55E' }, depot, arrets, troncons,
    typeLabels: { maintenance: 'Entretien' }, now: new Date(2026, 9, 25, 18, 5),
  });
  assert.equal(m.dateLabel, 'Lundi 26 octobre 2026');
  assert.deepEqual(m.items.map((i) => [i.id, i.rang, i.trajetAvant]), [
    ['a', 1, { minutes: 30, km: 25 }], ['x', 2, null], ['b', 3, { minutes: 20, km: 15 }],
  ]);
  assert.equal(m.items[1].localise, false);
  assert.equal(m.nbNonLocalises, 1);
  assert.deepEqual(m.retour, { minutes: 10, km: 8.4 });
  assert.deepEqual(m.totaux, { minutes: 60, km: 48.4 });
  assert.equal(m.items[0].time, '8:00 – 9:00');
  assert.equal(m.filename, 'feuille-de-route-mohammed-2026-10-26.pdf');
  assert.equal(m.estime, false);
});

test('buildFeuilleDeRoute : sans itinéraire, pas de totaux ni d\'estimation affichée', () => {
  const m = buildFeuilleDeRoute({ date: '2026-10-26', person: { displayName: 'Mohammed' }, arrets: [rdv()], troncons: null, estime: true });
  assert.equal(m.totaux, null);
  assert.equal(m.retour, null);
  assert.equal(m.estime, false);
  assert.equal(m.items[0].trajetAvant, null);
});

test('formats : durée et km PDF-safe', () => {
  assert.equal(formatDureeRoute(40), '40 min');
  assert.equal(formatDureeRoute(95), '1 h 35');
  assert.equal(formatDureeRoute(120), '2 h');
  assert.equal(formatKm(12.34), '12,3 km');
});

// --- Départ / retour par technicien (spec 2026-10-14) -------------------------
const maison = { lat: 43.78, lng: 1.41, label: 'Domicile (Bouloc)' };

test('pointsItineraire : part du départ, finit au retour ; sans retour, revient au départ', () => {
  const pts = pointsItineraire(maison, [rdv()], depot);
  assert.deepEqual([pts[0].lat, pts[pts.length - 1].lat], [43.78, 43.9]);
  const boucle = pointsItineraire(maison, [rdv()]);
  assert.equal(boucle[boucle.length - 1].lat, 43.78);
});

test('lienGoogleMapsTournee : origine = départ, destination = retour', () => {
  const url = lienGoogleMapsTournee(maison, [rdv()], depot);
  assert.ok(url.includes(`origin=${encodeURIComponent('43.78,1.41')}`));
  assert.ok(url.includes(`destination=${encodeURIComponent('43.9,1.9')}`));
});

test('urlCarteStatique : deux maisons quand le retour est ailleurs, une seule sinon', () => {
  const deux = urlCarteStatique({ points: pointsItineraire(maison, [rdv()], depot), token: 'tk' });
  assert.equal((deux.match(/pin-s-home/g) || []).length, 2);
  const une = urlCarteStatique({ points: pointsItineraire(maison, [rdv()]), token: 'tk' });
  assert.equal((une.match(/pin-s-home/g) || []).length, 1);
});

test('buildFeuilleDeRoute : libellés de départ et d arrivée, compat depot seul', () => {
  const m = buildFeuilleDeRoute({ date: '2026-10-26', person: { displayName: 'M' }, depart: maison, retour: depot, arrets: [rdv()] });
  assert.equal(m.departLabel, 'Domicile (Bouloc)');
  assert.equal(m.retourLabel, 'Siège Gaillac');
  const c = buildFeuilleDeRoute({ date: '2026-10-26', person: { displayName: 'M' }, depot, arrets: [rdv()] });
  assert.equal(c.departLabel, 'Siège Gaillac');
  assert.equal(c.retourLabel, 'Siège Gaillac');
});

test('decoderPolyline : exemple de référence Google, [lng, lat], vide si illisible', () => {
  // Exemple de la documentation Google (Encoded Polyline Algorithm Format).
  assert.deepEqual(decoderPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.deepEqual(decoderPolyline(''), []);
  assert.deepEqual(decoderPolyline(null), []);
  assert.deepEqual(decoderPolyline('_p~iF'), []);
});
