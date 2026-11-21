// Réactivation d'un lead perdu : il reprend la place qu'il avait avant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estStatutPerdu, statutDeRetour } from '../src/lib/leadReactivation.js';

const statuses = [
  { id: 'n', label: 'Nouveau', display_order: 1, is_final: false, is_won: false },
  { id: 'c', label: 'Contacté', display_order: 2, is_final: false, is_won: false },
  { id: 'r', label: 'RDV planifié', display_order: 3, is_final: false, is_won: false },
  { id: 'd', label: 'Devis envoyé', display_order: 4, is_final: false, is_won: false },
  { id: 'g', label: 'Gagné', display_order: 5, is_final: true, is_won: true },
  { id: 'p', label: 'Perdu', display_order: 6, is_final: true, is_won: false },
];
const audit = (avant, apres, quand) => ({
  table_name: 'leads', changed_fields: ['status_id', 'status_changed_at'],
  old_values: { status_id: avant }, new_values: { status_id: apres }, changed_at: quand,
});
const activite = (avant, apres, quand) => ({ old_status_id: avant, new_status_id: apres, created_at: quand });

test('estStatutPerdu : terminal et non gagné', () => {
  assert.equal(estStatutPerdu(statuses[5]), true);
  assert.equal(estStatutPerdu(statuses[4]), false);
  assert.equal(estStatutPerdu(statuses[0]), false);
  assert.equal(estStatutPerdu(null), false);
});

test('un lead qui n’est pas perdu n’a rien à réactiver', () => {
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'c' }), null);
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'g' }), null);
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'inconnu' }), null);
});

test('le lead revient dans le statut qu’il avait juste avant Perdu (journal d’audit)', () => {
  const r = statutDeRetour({
    statuses, statutActuelId: 'p',
    auditRows: [audit('n', 'c', '2026-11-01T08:00:00Z'), audit('c', 'r', '2026-11-05T08:00:00Z'), audit('r', 'p', '2026-11-10T08:00:00Z')],
  });
  assert.equal(r.label, 'RDV planifié');
});

test('perdu plusieurs fois : c’est le DERNIER passage en Perdu qui compte', () => {
  const r = statutDeRetour({
    statuses, statutActuelId: 'p',
    auditRows: [
      audit('n', 'p', '2026-11-01T08:00:00Z'), audit('p', 'n', '2026-11-01T08:01:00Z'),
      audit('n', 'c', '2026-11-02T08:00:00Z'), audit('c', 'p', '2026-11-03T08:00:00Z'),
    ],
  });
  assert.equal(r.label, 'Contacté');
});

test('sans journal d’audit, l’activité de la fiche suffit', () => {
  const r = statutDeRetour({ statuses, statutActuelId: 'p', activities: [activite('d', 'p', '2026-11-10T08:00:00Z')] });
  assert.equal(r.label, 'Devis envoyé');
});

test('au même instant, le journal d’audit prime sur l’activité', () => {
  const r = statutDeRetour({
    statuses, statutActuelId: 'p',
    auditRows: [audit('r', 'p', '2026-11-10T08:00:00Z')],
    activities: [activite('c', 'p', '2026-11-10T08:00:00Z')],
  });
  assert.equal(r.label, 'RDV planifié');
});

test('une trace d’une autre table ou sans changement de statut est ignorée', () => {
  const r = statutDeRetour({
    statuses, statutActuelId: 'p',
    auditRows: [
      { table_name: 'appointments', changed_fields: ['status_id'], old_values: { status_id: 'd' }, new_values: { status_id: 'p' }, changed_at: '2026-11-12T08:00:00Z' },
      { table_name: 'leads', changed_fields: ['notes'], old_values: { status_id: 'd' }, new_values: { status_id: 'p' }, changed_at: '2026-11-12T08:00:00Z' },
      audit('c', 'p', '2026-11-10T08:00:00Z'),
    ],
  });
  assert.equal(r.label, 'Contacté');
});

test('aucune trace, ou trace vers un statut terminal ou disparu : retour au premier statut ouvert', () => {
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'p' }).label, 'Nouveau');
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'p', auditRows: [audit('g', 'p', '2026-11-10T08:00:00Z')] }).label, 'Nouveau');
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'p', auditRows: [audit('supprime', 'p', '2026-11-10T08:00:00Z')] }).label, 'Nouveau');
  assert.equal(statutDeRetour({ statuses, statutActuelId: 'p', auditRows: [audit(undefined, 'p', '2026-11-10T08:00:00Z')] }).label, 'Nouveau');
});
