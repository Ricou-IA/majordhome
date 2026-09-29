// scripts/tournee/invitations.test.mjs — qui inviter, quand relancer
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contratsAInviter, etapeRelance } from '../../src/lib/tournee/invitations.js';

const reglages = { auto_rdv: { inclure_retardataires: true, relance_sms_jours: 7, escalade_appel_jours: 15 }, tolerance_anniversaire_mois: 2 };
const client = (over = {}) => ({ email: 'a@b.fr', first_name: 'Jean', last_name: 'Dupont', phone: '0612345678', mail_optin: null, email_unsubscribed_at: null, is_archived: false, ...over });
const contrat = (id, client_id, start_date, over = {}) => ({ id, client_id, start_date, current_year_visit_status: null, status: 'active', ...over });

test('contratsAInviter : anniversaire du mois, retardataires, un par client, exclusions comptées', () => {
  const contrats = [
    contrat('c1', 'k1', '2024-10-15'),                 // anniversaire octobre
    contrat('c2', 'k2', '2023-08-01'),                 // retard (août sans visite, tolérance 2 → en retard en octobre ? écart 2 = dans tolérance → pas retard)
    contrat('c3', 'k3', '2023-06-01'),                 // retard (juin)
    contrat('c4', 'k4', '2024-03-01'),                 // hors période (mars, à venir)
    contrat('c5', 'k5', '2024-10-02', { current_year_visit_status: 'completed' }), // déjà fait
    contrat('c6', 'k6', '2024-10-02'),                 // carte en cours
    contrat('c7', 'k7', '2024-10-02'),                 // déjà invité
    contrat('c8', 'k8', '2024-10-02'),                 // sans email
    contrat('c9', 'k9', '2024-10-02'),                 // désinscrit
    contrat('c10', 'k10', '2024-10-02'),               // opt-out
    contrat('c11', 'k11', '2024-10-02'),               // archivé
    contrat('c12', 'k1', '2024-10-20'),                // 2e contrat du client k1 → un seul
  ];
  const clients = new Map([
    ['k1', client()], ['k2', client()], ['k3', client()], ['k4', client()], ['k5', client()], ['k6', client()], ['k7', client()],
    ['k8', client({ email: '' })], ['k9', client({ email_unsubscribed_at: '2026-01-01T00:00:00Z' })], ['k10', client({ mail_optin: false })],
    ['k11', client({ is_archived: true })],
  ]);
  const r = contratsAInviter({ contrats, clients, cartesEnCours: new Set(['c6']), dejaInvites: new Set(['c7']), mois: '2026-10', reglages });
  assert.deepEqual(r.aInviter.map((i) => [i.contractId, i.raison]), [['c1', 'anniversaire'], ['c3', 'retard']]);
  assert.deepEqual(r.sansEmail.map((i) => i.contractId), ['c8']);
  assert.equal(r.exclus.deja_planifie, 1);
  assert.equal(r.exclus.deja_invite, 1);
  assert.equal(r.exclus.desinscrit, 1);
  assert.equal(r.exclus.optout, 1);
  assert.equal(r.exclus.archive, 1);
  assert.equal(r.exclus.sans_email, 1);
  assert.ok(r.exclus.hors_periode >= 1);
  assert.equal(r.aInviter[0].prenom, 'Jean');
});

test('contratsAInviter : retardataires exclus si le réglage est faux', () => {
  const r = contratsAInviter({
    contrats: [contrat('c3', 'k3', '2023-06-01')], clients: new Map([['k3', client()]]), cartesEnCours: new Set(), dejaInvites: new Set(),
    mois: '2026-10', reglages: { ...reglages, auto_rdv: { inclure_retardataires: false } },
  });
  assert.deepEqual(r.aInviter, []);
  assert.equal(r.exclus.hors_periode, 1);
});

test('etapeRelance : sms à J+7, appel à J+15, expiration après la fin du mois, rien si bookée', () => {
  const inv = { mois: '2026-10-01', sent_at: '2026-10-01T05:00:00Z', booked_at: null, sms_relance_at: null, escalade_appel_at: null, outcome: null };
  assert.equal(etapeRelance(inv, '2026-10-05', reglages), null);
  assert.equal(etapeRelance(inv, '2026-10-08', reglages), 'sms');
  assert.equal(etapeRelance({ ...inv, sms_relance_at: '2026-10-08T05:00:00Z' }, '2026-10-10', reglages), null);
  assert.equal(etapeRelance({ ...inv, sms_relance_at: '2026-10-08T05:00:00Z' }, '2026-10-16', reglages), 'appel');
  assert.equal(etapeRelance({ ...inv, sms_relance_at: '2026-10-08T05:00:00Z', escalade_appel_at: '2026-10-16T05:00:00Z' }, '2026-10-20', reglages), null);
  assert.equal(etapeRelance(inv, '2026-11-01', reglages), 'expire');
  assert.equal(etapeRelance({ ...inv, booked_at: '2026-10-03T10:00:00Z' }, '2026-10-20', reglages), null);
  assert.equal(etapeRelance({ ...inv, sent_at: null }, '2026-10-20', reglages), null, 'jamais envoyée : rien à relancer');
  assert.equal(etapeRelance({ ...inv, sent_at: null }, '2026-11-02', reglages), 'expire');
});
