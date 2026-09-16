// scripts/audit-trail.test.mjs — mise en forme du mouchard (src/lib/auditTrail.js)
// node --test scripts/audit-trail.test.mjs
//
// Le journal d'audit est écrit par un trigger Postgres (migration 20260916_3) :
// une ligne = QUI / QUAND / QUOI (champs modifiés, old/new) / PAR OÙ (RPC ou
// vue). Ce module transforme ces lignes brutes en entrées lisibles pour
// l'Historique d'un lead et d'un RDV. Ce test verrouille la lecture humaine :
// libellés FR, dates/heures/montants formatés, ids résolus en noms, auteur
// « Automatisation » quand aucun humain n'est derrière l'écriture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_FIELD_LABELS,
  buildAuditEntry,
  formatAuditValue,
  mergeTimeline,
  toNameMap,
} from '../src/lib/auditTrail.js';

const PHILIPPE = '69e365ef-b0a0-48b2-bd58-9c6c4f415c3f';
const STATUS_RDV = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';
const STATUS_DEVIS = '11111111-2222-4333-8444-555555555555';

const resolvers = {
  status_id: new Map([[STATUS_RDV, 'RDV planifié'], [STATUS_DEVIS, 'Devis envoyé']]),
  assigned_user_id: new Map([['8113ed48-5979-4ba9-a789-a4331ed25f00', 'Philippe Mazel']]),
};

const leadUpdate = {
  id: 1,
  table_name: 'leads',
  record_id: '212c9c6c-96aa-4784-8d19-7387e7d3d990',
  lead_id: '212c9c6c-96aa-4784-8d19-7387e7d3d990',
  action: 'UPDATE',
  changed_fields: ['appointment_date', 'notes', 'probability', 'status_id'],
  old_values: { appointment_date: '2026-09-16', notes: null, probability: 50, status_id: STATUS_RDV },
  new_values: { appointment_date: '2026-09-18', notes: 'Rappeler avant', probability: 60, status_id: STATUS_DEVIS },
  changed_by: PHILIPPE,
  changed_by_name: 'Philippe Mazel',
  changed_by_role: 'authenticated',
  source: 'update_majordhome_lead',
  changed_at: '2026-09-16T13:05:30.645Z',
};

test('une modification de lead par un humain : auteur, chemin, champs libellés et formatés', () => {
  const e = buildAuditEntry(leadUpdate, { resolvers });
  assert.equal(e.kind, 'audit');
  assert.equal(e.subject, 'Lead');
  assert.equal(e.author, 'Philippe Mazel');
  assert.equal(e.isHuman, true);
  assert.equal(e.sourceLabel, 'fiche lead');
  assert.equal(e.title, 'Modifié par Philippe Mazel via fiche lead');
  assert.equal(e.at, '2026-09-16T13:05:30.645Z');
  assert.deepEqual(
    e.changes.map((c) => [c.label, c.from, c.to]),
    [
      ['Date du RDV', '16/09/2026', '18/09/2026'],
      ['Notes', '—', 'Rappeler avant'],
      ['Probabilité', '50 %', '60 %'],
      ['Statut', 'RDV planifié', 'Devis envoyé'],
    ],
  );
});

test('une modification de RDV depuis le planning : heures en HH:MM, sujet RDV', () => {
  const e = buildAuditEntry({
    id: 2,
    table_name: 'appointments',
    record_id: '96f7a8c0-761f-47a2-8040-efc58a409ce3',
    lead_id: '212c9c6c-96aa-4784-8d19-7387e7d3d990',
    action: 'UPDATE',
    changed_fields: ['scheduled_date', 'scheduled_start'],
    old_values: { scheduled_date: '2026-09-16', scheduled_start: '15:00:00' },
    new_values: { scheduled_date: '2026-09-18', scheduled_start: '16:30:00' },
    changed_by: PHILIPPE,
    changed_by_name: 'Philippe Mazel',
    changed_by_role: 'authenticated',
    source: 'majordhome_appointments',
    changed_at: '2026-09-16T13:05:30.475Z',
  });
  assert.equal(e.subject, 'RDV');
  assert.equal(e.sourceLabel, 'planning');
  assert.deepEqual(
    e.changes.map((c) => [c.label, c.from, c.to]),
    [
      ['Date du RDV', '16/09/2026', '18/09/2026'],
      ['Heure de début', '15:00', '16:30'],
    ],
  );
});

test('une écriture sans humain derrière est une automatisation, avec son chemin', () => {
  const e = buildAuditEntry({
    ...leadUpdate,
    changed_by: null,
    changed_by_name: null,
    changed_by_role: 'service_role',
    source: 'pennylane_sync_update_quote_fields',
  });
  assert.equal(e.author, 'Automatisation');
  assert.equal(e.isHuman, false);
  assert.equal(e.sourceLabel, 'synchro Pennylane');
  assert.equal(e.title, 'Modifié par Automatisation via synchro Pennylane');
});

test('un chemin inconnu est montré tel quel, un chemin absent ne produit pas de « via »', () => {
  assert.equal(buildAuditEntry({ ...leadUpdate, source: 'rpc_toute_neuve' }).sourceLabel, 'rpc_toute_neuve');
  const sans = buildAuditEntry({ ...leadUpdate, source: null });
  assert.equal(sans.sourceLabel, null);
  assert.equal(sans.title, 'Modifié par Philippe Mazel');
});

test('un auteur sans profil résolu reste identifiable comme humain', () => {
  const e = buildAuditEntry({ ...leadUpdate, changed_by_name: null });
  assert.equal(e.author, 'Utilisateur inconnu');
  assert.equal(e.isHuman, true);
});

test('un id non résolu est abrégé plutôt qu’étalé sur 36 caractères', () => {
  const e = buildAuditEntry({
    ...leadUpdate,
    changed_fields: ['status_id'],
    old_values: { status_id: STATUS_RDV },
    new_values: { status_id: 'deadbeef-0000-4000-8000-000000000000' },
  }, { resolvers });
  assert.deepEqual(e.changes.map((c) => [c.from, c.to]), [['RDV planifié', 'deadbeef…']]);
});

test('une création ne liste que les champs qui situent la fiche, jamais la ligne entière', () => {
  const e = buildAuditEntry({
    ...leadUpdate,
    action: 'INSERT',
    changed_fields: ['id', 'org_id', 'first_name', 'last_name', 'status_id', 'assigned_user_id', 'email', 'created_at'],
    old_values: null,
    new_values: {
      id: leadUpdate.record_id, org_id: 'x', first_name: 'VALERIE', last_name: 'PERRON',
      status_id: STATUS_RDV, assigned_user_id: '8113ed48-5979-4ba9-a789-a4331ed25f00',
      email: 'v@example.org', created_at: '2026-09-16T12:52:59Z',
    },
    source: 'create_majordhome_lead',
  }, { resolvers });
  assert.equal(e.title, 'Créé par Philippe Mazel via création de lead');
  assert.deepEqual(
    e.changes.map((c) => [c.label, c.from, c.to]),
    [
      ['Statut', null, 'RDV planifié'],
      ['Commercial assigné', null, 'Philippe Mazel'],
    ],
  );
});

test('une suppression ne détaille rien : le fait suffit', () => {
  const e = buildAuditEntry({ ...leadUpdate, action: 'DELETE', changed_fields: ['id', 'last_name'], new_values: null, old_values: { id: 'x', last_name: 'PERRON' }, source: 'lead_hard_delete' });
  assert.equal(e.title, 'Supprimé par Philippe Mazel via suppression définitive');
  assert.deepEqual(e.changes, []);
});

test('formatage des valeurs : booléens, montants, minutes, horodatages, texte long, objets, champ inconnu', () => {
  assert.equal(formatAuditValue('leads', 'email_sent', true), 'Oui');
  assert.equal(formatAuditValue('leads', 'email_sent', false), 'Non');
  assert.equal(formatAuditValue('leads', 'order_amount_ht', 1234.5), '1 234,50 €');
  assert.equal(formatAuditValue('appointments', 'duration_minutes', 90), '90 min');
  assert.match(formatAuditValue('leads', 'last_call_date', '2026-09-16T13:05:30Z'), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.equal(formatAuditValue('leads', 'notes', 'a'.repeat(200)).length, 121); // 120 + …
  assert.equal(formatAuditValue('leads', 'external_data', { a: 1 }), '{"a":1}');
  assert.equal(formatAuditValue('leads', 'champ_futur', 'brut'), 'brut');
  assert.equal(formatAuditValue('leads', 'notes', ''), '—');
  assert.equal(formatAuditValue('leads', 'notes', null), '—');
  // Un champ inconnu du dictionnaire garde son nom technique en libellé.
  const e = buildAuditEntry({ ...leadUpdate, changed_fields: ['champ_futur'], old_values: { champ_futur: 1 }, new_values: { champ_futur: 2 } });
  assert.deepEqual(e.changes.map((c) => c.label), ['champ_futur']);
});

test('le dictionnaire couvre la date du RDV des deux côtés (lead et planning) avec le même mot', () => {
  assert.equal(AUDIT_FIELD_LABELS.leads.appointment_date, 'Date du RDV');
  assert.equal(AUDIT_FIELD_LABELS.appointments.scheduled_date, 'Date du RDV');
});

test('toNameMap accepte les formes des référentiels existants (label / name / full_name / display_name)', () => {
  const m = toNameMap([
    { id: 'a', label: 'Statut A' },
    { id: 'b', name: 'Source B' },
    { id: 'c', full_name: 'Commercial C' },
    { id: 'd', display_name: 'Tech D' },
    { id: null, label: 'ignoré' },
  ]);
  assert.deepEqual([...m.entries()], [['a', 'Statut A'], ['b', 'Source B'], ['c', 'Commercial C'], ['d', 'Tech D']]);
});

test('mergeTimeline fusionne activités et audit par date décroissante en gardant la nature de chaque entrée', () => {
  const activities = [
    { id: 'act-1', activity_type: 'lead_created', created_at: '2026-09-16T12:52:59Z', description: 'Lead cree' },
    { id: 'act-2', activity_type: 'status_changed', created_at: '2026-09-16T12:53:19Z', description: 'Statut' },
  ];
  const audit = [buildAuditEntry({ ...leadUpdate, changed_at: '2026-09-16T13:05:30Z' })];
  const merged = mergeTimeline(activities, audit);
  assert.deepEqual(merged.map((x) => [x.kind, x.id]), [['audit', 'audit-1'], ['activity', 'act-2'], ['activity', 'act-1']]);
  assert.equal(merged[1].at, '2026-09-16T12:53:19Z');
});
