// scripts/tournee/timeline.test.mjs
// Tests du placement des RDV sur la barre horaire (src/lib/tournee/timeline.js).
// L'enjeu de ces tests n'est pas la jolie barre : c'est qu'un RDV ne puisse
// JAMAIS disparaître de la vue sur laquelle on décide qu'un entretien « rentre ».
// Run : node --test scripts/tournee/timeline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireSegments, graduations, creneauxLibres } from '../../src/lib/tournee/timeline.js';

const JOURNEE = { debut: 480, fin: 1080 }; // 08:00 -> 18:00, span 600
const rdv = (id, start, duree, extra = {}) => ({
  id, scheduled_start: start, duration_minutes: duree, ...extra,
});

test('un RDV est placé à sa position réelle dans l amplitude', () => {
  const { segments, span } = construireSegments([rdv('a', '10:00', 120)], JOURNEE);
  assert.equal(span, 600);
  assert.equal(segments.length, 1);
  const [s] = segments;
  assert.equal(s.debutMinutes, 600);
  assert.equal(s.finMinutes, 720);
  assert.equal(s.leftPct, 20, '10h sur une journee 8h-18h = 20% de la barre');
  assert.equal(s.widthPct, 20, '2h sur 10h = 20%');
  assert.equal(s.deborde, false);
});

test('les segments sortent triés chronologiquement, quel que soit l ordre d entrée', () => {
  const { segments } = construireSegments(
    [rdv('tard', '16:00', 60), rdv('tot', '08:30', 60), rdv('midi', '11:00', 60)],
    JOURNEE,
  );
  assert.deepEqual(segments.map((s) => s.id), ['tot', 'midi', 'tard']);
});

test('un RDV SANS heure n est pas placé mais ressort dans sansHeure', () => {
  // Le taire le ferait lire comme un trou libre — il occupe pourtant le
  // technicien (chargeMinutes le compte, arrets.js le conserve).
  const { segments, sansHeure } = construireSegments(
    [rdv('ok', '09:00', 60), rdv('flou', null, 90), rdv('vide', '', 60)],
    JOURNEE,
  );
  assert.deepEqual(segments.map((s) => s.id), ['ok']);
  assert.deepEqual(sansHeure.map((r) => r.id), ['flou', 'vide'],
    'aucun RDV avale en silence');
});

test('un RDV qui déborde de l amplitude est placé quand même, clampé, et signalé', () => {
  // Cas reel : installation demarree avant l'ouverture, ou finissant apres.
  const { segments } = construireSegments(
    [rdv('avant', '07:00', 120), rdv('apres', '17:00', 180)],
    JOURNEE,
  );
  const avant = segments.find((s) => s.id === 'avant');
  assert.equal(avant.leftPct, 0, 'clampe au bord gauche');
  assert.equal(avant.debutMinutes, 420, 'mais son heure reelle est conservee');
  assert.equal(avant.deborde, true);

  const apres = segments.find((s) => s.id === 'apres');
  assert.equal(apres.deborde, true);
  assert.ok(apres.leftPct + apres.widthPct <= 100.001,
    'aucun segment ne sort de la barre');
});

test('un RDV entièrement hors amplitude garde une largeur visible', () => {
  const { segments } = construireSegments([rdv('nuit', '20:00', 60)], JOURNEE);
  assert.equal(segments.length, 1);
  assert.ok(segments[0].widthPct >= 1.5, 'un RDV invisible serait un RDV oublie');
});

test('amplitude dégénérée : aucun placement inventé, tout ressort en sansHeure', () => {
  for (const amplitude of [{ debut: 600, fin: 600 }, { debut: 700, fin: 500 }, null, {}]) {
    const { segments, sansHeure, span } = construireSegments([rdv('a', '10:00', 60)], amplitude);
    assert.equal(span, 0);
    assert.deepEqual(segments, []);
    assert.equal(sansHeure.length, 1, 'le RDV reste visible par l autre canal');
  }
});

test('durée manquante : même défaut de 60 min que le reste du module', () => {
  const { segments } = construireSegments([{ id: 'a', scheduled_start: '10:00' }], JOURNEE);
  assert.equal(segments[0].finMinutes, 660);
});

test('graduations — heures rondes alignées sur le pas, jamais décalées', () => {
  const g = graduations({ debut: 487, fin: 1080 }, 120); // ouverture a 8h07
  assert.deepEqual(g.map((r) => r.heure), [10, 12, 14, 16, 18],
    'des reperes a 8h07 / 10h07 seraient illisibles');
  assert.equal(g[0].leftPct > 0, true);
});

test('graduations — amplitude dégénérée ou pas nul : liste vide, pas de boucle infinie', () => {
  assert.deepEqual(graduations({ debut: 600, fin: 600 }), []);
  assert.deepEqual(graduations(JOURNEE, 0), []);
  assert.deepEqual(graduations(null), []);
});

test('creneauxLibres — les trous encadrent les RDV, bornes de journée comprises', () => {
  const { segments } = construireSegments(
    [rdv('a', '09:00', 60), rdv('b', '14:00', 120)],
    JOURNEE,
  );
  const trous = creneauxLibres(segments, JOURNEE);
  assert.deepEqual(
    trous.map((t) => [t.debutMinutes, t.finMinutes]),
    [[480, 540], [600, 840], [960, 1080]],
    '8h-9h, 10h-14h puis 16h-18h',
  );
  assert.equal(trous[1].dureeMinutes, 240);
});

test('creneauxLibres — journée pleine : aucun trou, jamais un trou négatif', () => {
  const { segments } = construireSegments([rdv('plein', '08:00', 600)], JOURNEE);
  assert.deepEqual(creneauxLibres(segments, JOURNEE), []);
});

test('creneauxLibres — deux RDV qui se chevauchent ne fabriquent pas de trou fantôme', () => {
  // Un chevauchement est un vrai cas (RDV pose hors module, ou a 2 techniciens) :
  // il ne doit surtout pas produire un creneau "libre" a l'interieur.
  const { segments } = construireSegments(
    [rdv('long', '09:00', 240), rdv('dedans', '10:00', 60)],
    JOURNEE,
  );
  const trous = creneauxLibres(segments, JOURNEE);
  assert.deepEqual(
    trous.map((t) => [t.debutMinutes, t.finMinutes]),
    [[480, 540], [780, 1080]],
    'aucun trou entre 9h et 13h, malgre le RDV imbrique',
  );
  assert.ok(trous.every((t) => t.dureeMinutes > 0));
});

test('creneauxLibres — un RDV débordant ne crée pas de trou hors des bornes', () => {
  const { segments } = construireSegments([rdv('avant', '06:00', 180)], JOURNEE);
  const trous = creneauxLibres(segments, JOURNEE);
  assert.deepEqual(trous.map((t) => [t.debutMinutes, t.finMinutes]), [[540, 1080]]);
  assert.ok(trous.every((t) => t.debutMinutes >= JOURNEE.debut && t.finMinutes <= JOURNEE.fin));
});
