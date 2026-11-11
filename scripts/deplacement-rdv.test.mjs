import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peutDeplacer, patchDeplacement, patchRetour } from '../src/lib/deplacementRdv.js';

const apt = {
  id: 'r1', scheduled_date: '2026-11-12', scheduled_start: '10:00:00', scheduled_end: '11:00:00', duration_minutes: 60,
  technician_ids: ['ludo', 'moh'], assigned_commercial_id: null,
};
const vers = (over) => ({ fromMemberId: 'ludo', toMemberId: 'ludo', date: '2026-11-12', startTime: '10:00', endTime: '11:00', duration: 60, ...over });

test('peutDeplacer : facturé et figé restent en place', () => {
  assert.equal(peutDeplacer(apt).ok, true);
  assert.equal(peutDeplacer({ ...apt, target_invoiced: true }).ok, false);
  assert.match(peutDeplacer({ ...apt, hour_confirmed_at: '2026-11-01T10:00:00Z' }).raison, /figé/);
  assert.equal(peutDeplacer(null).ok, false);
});

test('patchDeplacement : même colonne = horaire seul ; rien bougé = inchangé', () => {
  const r = patchDeplacement(apt, vers({ startTime: '13:30', endTime: '14:30' }));
  assert.deepEqual(r.horaire, { scheduled_date: '2026-11-12', scheduled_start: '13:30', scheduled_end: '14:30', duration_minutes: 60 });
  assert.equal(r.reaffectation, null);
  assert.equal(r.inchange, false);
  assert.equal(patchDeplacement(apt, vers()).inchange, true);
});

test('patchDeplacement : autre colonne = la personne d\'origine remplacée, les autres gardées, sans doublon', () => {
  assert.deepEqual(patchDeplacement(apt, vers({ toMemberId: 'lucas' })).reaffectation, { technicianIds: ['lucas', 'moh'] });
  assert.deepEqual(patchDeplacement(apt, vers({ toMemberId: 'moh' })).reaffectation, { technicianIds: ['moh'] });
  const vt = { ...apt, technician_ids: [], assigned_commercial_id: 'com-1' };
  assert.deepEqual(patchDeplacement(vt, vers({ fromMemberId: 'com-1', toMemberId: 'com-2' })).reaffectation, { assigned_commercial_id: 'com-2' });
});

test('patchRetour : remet horaire et personnes d\'origine', () => {
  const { reaffectation } = patchDeplacement(apt, vers({ toMemberId: 'lucas', startTime: '14:00', endTime: '15:00' }));
  assert.deepEqual(patchRetour(apt, reaffectation), {
    horaire: { scheduled_date: '2026-11-12', scheduled_start: '10:00', scheduled_end: '11:00', duration_minutes: 60 },
    reaffectation: { technicianIds: ['ludo', 'moh'] },
  });
  assert.equal(patchRetour(apt, null).reaffectation, null);
});
