import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etatConfirmation, deplacementDemandeAccord, rappelPropose, champsDeConfirmation, SEUIL_A_CONFIRMER_JOURS,
} from '../src/lib/confirmationRdv.js';

const maintenant = new Date(2026, 10, 23, 10, 0); // 23 nov. 2026, heure locale
const ilYa = (jours) => new Date(maintenant.getTime() - jours * 86_400_000).toISOString();
const rdv = (extra = {}) => ({ appointment_type: 'maintenance', status: 'scheduled', scheduled_date: '2026-12-01', created_at: ilYa(3), ...extra });

test('etatConfirmation : confirmé dès que client_confirmed_at est posé', () => {
  assert.equal(etatConfirmation(rdv({ client_confirmed_at: ilYa(1) }), maintenant).etat, 'confirme');
});

test('etatConfirmation : provisoire tant que récent, « à confirmer » au-delà du seuil', () => {
  assert.equal(etatConfirmation(rdv(), maintenant).etat, 'provisoire');
  assert.equal(etatConfirmation(rdv({ created_at: ilYa(SEUIL_A_CONFIRMER_JOURS) }), maintenant).etat, 'provisoire');
  const vieux = etatConfirmation(rdv({ created_at: ilYa(61) }), maintenant);
  assert.equal(vieux.etat, 'a_confirmer');
  assert.equal(vieux.joursDepuisPose, 61);
});

test('etatConfirmation : un RDV passé n\'est jamais « à confirmer »', () => {
  assert.equal(etatConfirmation(rdv({ scheduled_date: '2026-11-20', created_at: ilYa(90) }), maintenant).etat, 'provisoire');
  assert.equal(etatConfirmation(rdv({ scheduled_date: '2026-11-23', created_at: ilYa(90) }), maintenant).etat, 'a_confirmer');
});

test('etatConfirmation : congés, « Autre », annulé, terminé, absent = sans objet', () => {
  for (const r of [rdv({ appointment_type: 'leave' }), rdv({ appointment_type: 'other' }), rdv({ status: 'cancelled' }), rdv({ status: 'completed' }), null]) {
    assert.equal(etatConfirmation(r, maintenant).etat, 'sans_objet');
  }
});

test('deplacementDemandeAccord : seulement un RDV confirmé et à venir', () => {
  assert.equal(deplacementDemandeAccord(rdv({ client_confirmed_at: ilYa(1) }), maintenant), true);
  assert.equal(deplacementDemandeAccord(rdv(), maintenant), false);
  assert.equal(deplacementDemandeAccord(rdv({ client_confirmed_at: ilYa(1), scheduled_date: '2026-11-01' }), maintenant), false);
});

test('rappelPropose : entretien et SAV, pas annulé', () => {
  assert.equal(rappelPropose(rdv()), true);
  assert.equal(rappelPropose(rdv({ appointment_type: 'service' })), true);
  assert.equal(rappelPropose(rdv({ appointment_type: 'installation' })), false);
  assert.equal(rappelPropose(rdv({ status: 'cancelled' })), false);
});

test('champsDeConfirmation : confirmer fige un RDV adaptable non figé, retirer ne défige rien', () => {
  const iso = maintenant.toISOString();
  assert.deepEqual(champsDeConfirmation({ time_flex_minutes: 240 }, true, { adaptable: true, maintenant }), { client_confirmed_at: iso, hour_confirmed_at: iso, time_flex_minutes: 0 });
  assert.deepEqual(champsDeConfirmation({ hour_confirmed_at: ilYa(2), time_flex_minutes: 0 }, true, { adaptable: true, maintenant }), { client_confirmed_at: iso });
  assert.deepEqual(champsDeConfirmation({}, true, { adaptable: false, maintenant }), { client_confirmed_at: iso });
  assert.deepEqual(champsDeConfirmation({ hour_confirmed_at: ilYa(2) }, false, { adaptable: true, maintenant }), { client_confirmed_at: null });
});
