import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateLocale, heureLocale, plageDeVue, creneauDeSelection, creneauParDefaut, idDuRdv, horaireDeBloc,
  jourDOuverture,
} from '../src/lib/planningGestes.js';

const le = (j, h = 0, m = 0) => new Date(2026, 10, j, h, m);

test('dateLocale / heureLocale : jamais de recul en UTC', () => {
  // Minuit local : toISOString() donnerait la veille en France.
  assert.equal(dateLocale(le(16)), '2026-11-16');
  assert.equal(dateLocale(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
  assert.equal(heureLocale(le(16, 8, 5)), '08:05');
  assert.equal(heureLocale(le(16, 14, 30)), '14:30');
});

test('plageDeVue : semaine = plage, période et numéro de semaine', () => {
  const info = {
    start: le(16), end: le(23), startStr: '2026-11-16T00:00:00+01:00', endStr: '2026-11-23T00:00:00+01:00',
    view: { type: 'timeGridWeek', title: '16 – 22 nov. 2026', currentStart: le(16), currentEnd: le(23) },
  };
  assert.deepEqual(plageDeVue(info), {
    vue: 'timeGridWeek',
    titre: '16 – 22 nov. 2026',
    plage: { startDate: '2026-11-16', endDate: '2026-11-23' },
    periode: { debut: '2026-11-16', finExclue: '2026-11-23' },
    semaine: 47,
  });
  assert.equal(plageDeVue({ ...info, view: { ...info.view, type: 'listDay' } }).semaine, 47);
});

test('plageDeVue : en vue Mois la grille déborde, la période reste le mois, pas de semaine', () => {
  const info = {
    start: new Date(2026, 9, 26), end: new Date(2026, 11, 7),
    view: { type: 'dayGridMonth', title: 'novembre 2026', currentStart: le(1), currentEnd: new Date(2026, 11, 1) },
  };
  const p = plageDeVue(info);
  // Sans startStr / endStr : dates locales de la grille.
  assert.deepEqual(p.plage, { startDate: '2026-10-26', endDate: '2026-12-07' });
  assert.deepEqual(p.periode, { debut: '2026-11-01', finExclue: '2026-12-01' });
  assert.equal(p.semaine, null);
});

test('creneauDeSelection : heure cliquée, ou 9 h pour une journée entière', () => {
  assert.deepEqual(creneauDeSelection({ start: le(17, 14, 30) }), { defaultDate: '2026-11-17', defaultTime: '14:30' });
  // Vue Mois : la sélection commence à minuit local — le jour ne recule pas.
  assert.deepEqual(creneauDeSelection({ start: le(17), allDay: true }), { defaultDate: '2026-11-17', defaultTime: '09:00' });
});

test('creneauParDefaut : aujourd’hui en date locale, 9 h', () => {
  assert.deepEqual(creneauParDefaut(new Date(2026, 10, 16, 0, 20)), { defaultDate: '2026-11-16', defaultTime: '09:00' });
});

test('jourDOuverture : en semaine rien à imposer, le week-end le lundi suivant', () => {
  assert.equal(jourDOuverture(le(16, 8)), undefined);          // lundi
  assert.equal(jourDOuverture(le(20, 23, 59)), undefined);     // vendredi soir
  assert.equal(jourDOuverture(le(21, 0, 20)), '2026-11-23');   // samedi juste après minuit
  assert.equal(jourDOuverture(le(22, 18)), '2026-11-23');      // dimanche
  assert.equal(jourDOuverture(new Date(2026, 10, 28, 9)), '2026-11-30');
  assert.equal(jourDOuverture(new Date(2027, 0, 30, 9)), '2027-02-01'); // samedi 30 janvier : le lundi est en février
});

test('idDuRdv : l’id réel d’un bloc de RDV à plusieurs techniciens', () => {
  assert.equal(idDuRdv({ id: 'rdv1__tech2', extendedProps: { id: 'rdv1' } }), 'rdv1');
  assert.equal(idDuRdv({ id: 'rdv1', extendedProps: {} }), 'rdv1');
  assert.equal(idDuRdv(null), undefined);
});

test('horaireDeBloc : RDV glissé ou étiré', () => {
  assert.deepEqual(horaireDeBloc({ start: le(18, 8, 30), end: le(18, 10) }), {
    scheduled_date: '2026-11-18', scheduled_start: '08:30', scheduled_end: '10:00', duration_minutes: 90,
  });
  // Sans fin (glissé depuis la vue Mois) : une heure.
  assert.deepEqual(horaireDeBloc({ start: le(18, 9) }), {
    scheduled_date: '2026-11-18', scheduled_start: '09:00', scheduled_end: '10:00', duration_minutes: 60,
  });
  // Tôt le matin : la date reste celle du jour (toISOString reculait d'un jour avant 1 h).
  assert.equal(horaireDeBloc({ start: le(18, 0, 30), end: le(18, 1, 30) }).scheduled_date, '2026-11-18');
});

test('plagesVoisines : semaine précédente et suivante, mêmes bornes que le calendrier', async () => {
  const { plagesVoisines } = await import('../src/lib/planningGestes.js');
  // Bornes relevées sur l'application : la semaine du 16 novembre se charge du 16 au 21 (samedi exclu).
  assert.deepEqual(plagesVoisines({ vue: 'timeGridWeek', startDate: '2026-11-16', endDate: '2026-11-21' }), [
    { startDate: '2026-11-09', endDate: '2026-11-14' },
    { startDate: '2026-11-23', endDate: '2026-11-28' },
  ]);
  // Changement de mois et d'année.
  assert.deepEqual(plagesVoisines({ vue: 'listWeek', startDate: '2026-12-28', endDate: '2027-01-02' }), [
    { startDate: '2026-12-21', endDate: '2026-12-26' },
    { startDate: '2027-01-04', endDate: '2027-01-09' },
  ]);
});

test('plagesVoisines : vue Jour = jour ouvré voisin ; vue Mois et plage inconnue = rien', async () => {
  const { plagesVoisines } = await import('../src/lib/planningGestes.js');
  // Vendredi 20 → jeudi 19 et lundi 23 ; lundi 16 → vendredi 13 et mardi 17.
  assert.deepEqual(plagesVoisines({ vue: 'timeGridDay', startDate: '2026-11-20', endDate: '2026-11-21' }), [
    { startDate: '2026-11-19', endDate: '2026-11-20' },
    { startDate: '2026-11-23', endDate: '2026-11-24' },
  ]);
  assert.deepEqual(plagesVoisines({ vue: 'listDay', startDate: '2026-11-16', endDate: '2026-11-17' }), [
    { startDate: '2026-11-13', endDate: '2026-11-14' },
    { startDate: '2026-11-17', endDate: '2026-11-18' },
  ]);
  assert.deepEqual(plagesVoisines({ vue: 'dayGridMonth', startDate: '2026-10-26', endDate: '2026-12-07' }), []);
  assert.deepEqual(plagesVoisines({ vue: 'timeGridWeek', startDate: null, endDate: null }), []);
});

// --- Bornes de la grille horaire -------------------------------------------
{
  const { bornesDeGrille } = await import('../src/lib/planningGestes.js');
  const rdv = (debut, fin, extra = {}) => ({ start: `2026-11-16T${debut}`, end: fin ? `2026-11-16T${fin}` : null, ...extra });

  test('bornesDeGrille : 8 h → 18 h sans RDV, ou avec des RDV dans la plage', () => {
    assert.deepEqual(bornesDeGrille([]), { slotMinTime: '08:00:00', slotMaxTime: '18:00:00' });
    assert.deepEqual(bornesDeGrille([rdv('08:00:00', '17:00:00'), rdv('09:30:00', '18:00:00')]),
      { slotMinTime: '08:00:00', slotMaxTime: '18:00:00' });
  });

  test('bornesDeGrille : s\'étend à l\'heure ronde pour un RDV plus tôt ou plus tard', () => {
    assert.deepEqual(bornesDeGrille([rdv('07:30:00', '09:00:00'), rdv('18:00:00', '19:10:00')]),
      { slotMinTime: '07:00:00', slotMaxTime: '20:00:00' });
  });

  test('bornesDeGrille : RDV sans fin = une heure ; bande de tolérance ignorée', () => {
    assert.deepEqual(bornesDeGrille([rdv('17:30:00', null)]).slotMaxTime, '19:00:00');
    assert.deepEqual(bornesDeGrille([rdv('06:00:00', '20:00:00', { display: 'background' })]),
      { slotMinTime: '08:00:00', slotMaxTime: '18:00:00' });
  });
}

test('vue et date du planning dans l’URL', async () => {
  const { vueDepuisUrl, valeurUrlDeVue, dateDepuisUrl } = await import('../src/lib/planningGestes.js');
  const bureau = ['timeGridDay', 'timeGridWeek', 'dayGridMonth'];
  assert.equal(vueDepuisUrl('mois', bureau), 'dayGridMonth');
  assert.equal(vueDepuisUrl('jour-liste', bureau), null, 'vue non proposée sur cet appareil');
  assert.equal(vueDepuisUrl('xyz', bureau), null);
  assert.equal(vueDepuisUrl(null, bureau), null);
  assert.equal(valeurUrlDeVue('dayGridMonth'), 'mois');
  assert.equal(valeurUrlDeVue('listWeek'), 'semaine-liste');
  assert.equal(valeurUrlDeVue('inconnue'), null);
  assert.equal(dateDepuisUrl('2026-11-24'), '2026-11-24');
  assert.equal(dateDepuisUrl('2026-02-30'), null);
  assert.equal(dateDepuisUrl('24/11/2026'), null);
  assert.equal(dateDepuisUrl(null), null);
});
