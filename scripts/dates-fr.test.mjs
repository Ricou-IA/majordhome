import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateLongueFR, lireSaisieDate, versIso, depuisIso, joursFeries, saisieDepuisIso, raccourcisDate } from '../src/lib/datesFr.js';

test('formatDateLongueFR : « lun. 23 nov. 2026 »', () => {
  assert.equal(formatDateLongueFR('2026-11-23'), 'lun. 23 nov. 2026');
  assert.equal(formatDateLongueFR('2026-01-01'), 'jeu. 1 janv. 2026');
  assert.equal(formatDateLongueFR(''), '');
  assert.equal(formatDateLongueFR('2026-02-31'), '');
  assert.equal(formatDateLongueFR(null), '');
});

test('lireSaisieDate : jj/mm/aaaa et variantes, dates impossibles refusées', () => {
  assert.equal(lireSaisieDate('23/11/2026'), '2026-11-23');
  assert.equal(lireSaisieDate('23/11/26'), '2026-11-23');
  assert.equal(lireSaisieDate('23-11-2026'), '2026-11-23');
  assert.equal(lireSaisieDate('23.11.2026'), '2026-11-23');
  assert.equal(lireSaisieDate(' 1/2/2026 '), '2026-02-01');
  assert.equal(lireSaisieDate('31/02/2026'), null);
  assert.equal(lireSaisieDate('12/13/2026'), null);
  assert.equal(lireSaisieDate('01/01/1850'), null);
  assert.equal(lireSaisieDate('n’importe quoi'), null);
  assert.equal(lireSaisieDate(''), '');
  assert.equal(lireSaisieDate('   '), '');
  assert.equal(lireSaisieDate('29/02/2028'), '2028-02-29');
  assert.equal(lireSaisieDate('29/02/2027'), null);
});

test('versIso / depuisIso : date locale, jamais un jour de décalage', () => {
  assert.equal(versIso(new Date(2026, 10, 23, 23, 30)), '2026-11-23');
  assert.equal(versIso(new Date(2026, 10, 23, 0, 5)), '2026-11-23');
  const d = depuisIso('2026-11-23');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 23);
  assert.equal(depuisIso('pas une date'), null);
  assert.equal(depuisIso(''), null);
});

test('saisieDepuisIso : jj/mm/aaaa pour le champ', () => {
  assert.equal(saisieDepuisIso('2026-11-03'), '03/11/2026');
  assert.equal(saisieDepuisIso(''), '');
  assert.equal(saisieDepuisIso(null), '');
});

test('joursFeries : les 11 jours fériés de métropole', () => {
  const j = joursFeries(2026);
  assert.equal(j.length, 11);
  for (const d of ['2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25', '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25']) {
    assert.ok(j.includes(d), d);
  }
  assert.ok(joursFeries(2027).includes('2027-03-29')); // lundi de Pâques 2027
});

test('raccourcisDate : aujourd’hui, demain, lundi prochain', () => {
  const r = raccourcisDate(new Date(2026, 10, 25, 10)); // mercredi
  assert.deepEqual(r.map((x) => [x.label, x.iso]), [
    ['Aujourd’hui', '2026-11-25'],
    ['Demain', '2026-11-26'],
    ['Lundi prochain', '2026-11-30'],
  ]);
  assert.equal(raccourcisDate(new Date(2026, 10, 30, 10))[2].iso, '2026-12-07'); // un lundi : le suivant
});

test('lireSaisieDate : chiffres seuls, année à deux chiffres au bon siècle', () => {
  const maintenant = new Date(2026, 10, 23);
  assert.equal(lireSaisieDate('23112026', maintenant), '2026-11-23');
  assert.equal(lireSaisieDate('231126', maintenant), '2026-11-23');
  assert.equal(lireSaisieDate('15/03/85', maintenant), '1985-03-15');
  assert.equal(lireSaisieDate('15/03/36', maintenant), '2036-03-15');
  assert.equal(lireSaisieDate('15/03/37', maintenant), '1937-03-15');
  assert.equal(lireSaisieDate('2311202', maintenant), null);
});

test('depuisIso : un horodatage se lit par sa date', () => {
  const d = depuisIso('2026-11-23T10:00:00+00:00');
  assert.equal(d.getDate(), 23);
  assert.equal(formatDateLongueFR('2026-11-23 08:00:00'), 'lun. 23 nov. 2026');
});
