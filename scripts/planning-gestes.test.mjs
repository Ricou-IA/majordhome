import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateLocale, heureLocale, plageDeVue, creneauDeSelection, creneauParDefaut, idDuRdv, horaireDeBloc,
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
