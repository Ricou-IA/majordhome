// scripts/tournee/timeline.test.mjs
// Tests du placement des RDV sur la barre horaire (src/lib/tournee/timeline.js).
// L'enjeu de ces tests n'est pas la jolie barre : c'est qu'un RDV ne puisse
// JAMAIS disparaître de la vue sur laquelle on décide qu'un entretien « rentre ».
// Run : node --test scripts/tournee/timeline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construireSegments, graduations, creneauxLibres, bornesDeplacement, appliquerDecalages,
} from '../../src/lib/tournee/timeline.js';
import { construireArretsExistants } from '../../src/lib/tournee/arrets.js';

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

// ============================================================================
// DÉCALAGE MANUEL
// ============================================================================

test('bornesDeplacement — un RDV bute sur ses voisins, il ne les traverse pas', () => {
  const { segments } = construireSegments(
    [rdv('a', '08:00', 60), rdv('b', '11:00', 60), rdv('c', '15:00', 60)],
    JOURNEE,
  );
  const b = bornesDeplacement(segments, 'b', JOURNEE);
  assert.equal(b.minDebut, 540, 'pas avant la fin de A (9h)');
  assert.equal(b.maxDebut, 840, 'pas au-dela du debut de C moins sa duree (14h)');
  assert.equal(b.dureeMinutes, 60);
});

test('bornesDeplacement — sans voisin, les bornes sont celles de la journée', () => {
  const { segments } = construireSegments([rdv('seul', '10:00', 120)], JOURNEE);
  const b = bornesDeplacement(segments, 'seul', JOURNEE);
  assert.equal(b.minDebut, 480);
  assert.equal(b.maxDebut, 960, 'fin de journee moins la duree');
});

test('bornesDeplacement — la position actuelle reste toujours atteignable', () => {
  // Un RDV qui deborde deja (installation commencee a 7h) ne doit pas sauter a
  // 8h des qu'on le touche : personne n'a demande ce deplacement, et c'est une
  // heure promise a un client.
  const { segments } = construireSegments([rdv('tot', '07:00', 120)], JOURNEE);
  const b = bornesDeplacement(segments, 'tot', JOURNEE);
  assert.equal(b.minDebut, 420, 'sa propre position reste dans les bornes');
  assert.ok(b.maxDebut >= b.minDebut);
});

test('bornesDeplacement — deux RDV déjà en chevauchement ne produisent pas de bornes inversées', () => {
  const { segments } = construireSegments(
    [rdv('long', '09:00', 240), rdv('dedans', '10:00', 60)],
    JOURNEE,
  );
  for (const id of ['long', 'dedans']) {
    const b = bornesDeplacement(segments, id, JOURNEE);
    assert.ok(b.maxDebut >= b.minDebut, `${id} : bornes coherentes malgre le chevauchement`);
  }
});

test('bornesDeplacement — id inconnu : null, jamais des bornes inventées', () => {
  const { segments } = construireSegments([rdv('a', '09:00', 60)], JOURNEE);
  assert.equal(bornesDeplacement(segments, 'fantome', JOURNEE), null);
  assert.equal(bornesDeplacement([], 'a', JOURNEE), null);
});

test('appliquerDecalages — seule l heure bouge, la durée est intacte', () => {
  const rdvs = [rdv('a', '09:00', 90), rdv('b', '14:00', 60)];
  const out = appliquerDecalages(rdvs, new Map([['a', 45]]));
  assert.equal(out[0].scheduled_start, '09:45');
  assert.equal(out[0].scheduled_end, '11:15');
  assert.equal(out[0].duration_minutes, 90, 'la duree ne bouge pas');
  assert.equal(out[0].decalageMinutes, 45);
  assert.equal(out[1].scheduled_start, '14:00', 'les autres RDV sont intacts');
  assert.equal(out[1].decalageMinutes, undefined);
});

test('appliquerDecalages — décalage négatif, et aucune mutation de l entrée', () => {
  const rdvs = [rdv('a', '10:00', 60)];
  const out = appliquerDecalages(rdvs, new Map([['a', -90]]));
  assert.equal(out[0].scheduled_start, '08:30');
  assert.equal(rdvs[0].scheduled_start, '10:00', 'l entree n est jamais mutee');
});

test('appliquerDecalages — sans décalage, la liste passe telle quelle', () => {
  const rdvs = [rdv('a', '09:00', 60)];
  assert.equal(appliquerDecalages(rdvs, null), rdvs);
  assert.equal(appliquerDecalages(rdvs, new Map()), rdvs);
});

test('appliquerDecalages — un RDV sans heure n est pas décalé, jamais inventé', () => {
  const out = appliquerDecalages([rdv('flou', null, 60)], new Map([['flou', 60]]));
  assert.equal(out[0].scheduled_start, null);
  assert.equal(out[0].decalageMinutes, undefined);
});

test('un décalage se propage jusqu au séquenceur : la fenêtre suit la nouvelle heure', () => {
  // C'est le point qui compte : le decalage n'est pas qu'un effet visuel, il
  // doit changer ce que le moteur considere comme contraint. Un seul point
  // d'injection (appliquerDecalages) alimente arrets.js comme la barre.
  const rdvs = [rdv('a', '09:00', 60, { lat: 43.9, lng: 1.9 })];
  const [avant] = construireArretsExistants(rdvs);
  assert.deepEqual(avant.fenetre, { debut: 540, fin: 540 });

  const [apres] = construireArretsExistants(appliquerDecalages(rdvs, new Map([['a', 120]])));
  assert.deepEqual(apres.fenetre, { debut: 660, fin: 660 }, 'le moteur voit 11h, pas 9h');
  assert.equal(apres.dureeMinutes, 60);
});
