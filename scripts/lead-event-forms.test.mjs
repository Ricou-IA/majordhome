// scripts/lead-event-forms.test.mjs
// Non-régression du découpage de LeadModal (e7d0be6a) et d'EventModal (a73f0fab) : les modules purs
// src/lib/leadForm.js et src/lib/eventForm.js doivent rendre exactement ce que le code inline rendait
// (payloads envoyés à la base, formulaire pré-rempli, validation, recalcul horaire, objet auto).
// Run : node --test scripts/lead-event-forms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_LEAD_FORM, newLeadForm, leadToForm, contactPayload, buildLeadPayload } from '../src/lib/leadForm.js';
import {
  EMPTY_CONTACT, contactFromRecord, appointmentToForm, newEventForm, linkedClientFromAppointment,
  linkedLeadFromAppointment, linkedClientFromPrefill, applyFieldChange, validateEventForm,
  dupDecisionOf, clientLabelOf, autoSubjectFor,
} from '../src/lib/eventForm.js';

// ---------------------------------------------------------------------------
// leadForm
// ---------------------------------------------------------------------------

const leadFormSaisi = {
  ...EMPTY_LEAD_FORM,
  first_name: '  Céline ', last_name: ' Cassagne ', company_name: '   ',
  email: ' celine@gmail.com ', phone: '06 88 59 32 57', phone_secondary: '',
  address: '12 rue des Lilas', address_complement: '', postal_code: '81600', city: 'Gaillac',
  source_id: 'src-1', status_id: 'st-1', assigned_user_id: '',
  equipment_type_id: '', project_family_key: 'poele', order_amount_ht: '4500', estimated_revenue: '999',
  probability: '', next_action: '  Rappeler ', next_action_date: '2026-11-04',
  notes: ' ', lost_reason: '', appointment_date: '', quote_sent_date: '2026-10-30', won_date: '',
  email_sent: false,
};

test('buildLeadPayload : trim, vides → null, montants en nombre, CA estimé = montant HT, probabilité 50 par défaut', () => {
  assert.deepEqual(buildLeadPayload(leadFormSaisi, 'client-9'), {
    first_name: 'Céline', last_name: 'Cassagne', company_name: null,
    email: 'celine@gmail.com', phone: '06 88 59 32 57', phone_secondary: null,
    address: '12 rue des Lilas', address_complement: null, postal_code: '81600', city: 'Gaillac',
    source_id: 'src-1', status_id: 'st-1', assigned_user_id: null,
    equipment_type_id: null, project_family_key: 'poele',
    order_amount_ht: 4500, estimated_revenue: 4500, probability: 50,
    next_action: 'Rappeler', next_action_date: '2026-11-04',
    notes: null, lost_reason: null,
    appointment_date: null, quote_sent_date: '2026-10-30', won_date: null,
    email_sent: false, client_id: 'client-9',
  });
});

test('buildLeadPayload : sans montant ni client → null ; probabilité saisie conservée', () => {
  const p = buildLeadPayload({ ...leadFormSaisi, order_amount_ht: '', probability: '80', email_sent: true }, undefined);
  assert.equal(p.order_amount_ht, null);
  assert.equal(p.estimated_revenue, null);
  assert.equal(p.probability, 80);
  assert.equal(p.email_sent, true);
  assert.equal(p.client_id, null);
});

test('contactPayload : mêmes champs que le lead pour la fiche client, nom de famille jamais à null', () => {
  const c = contactPayload({ ...leadFormSaisi, last_name: '   ' });
  assert.deepEqual(Object.keys(c), [
    'first_name', 'last_name', 'company_name', 'email', 'phone', 'phone_secondary',
    'address', 'address_complement', 'postal_code', 'city',
  ]);
  assert.equal(c.last_name, '');
  assert.equal(c.first_name, 'Céline');
});

test('leadToForm : null → chaîne vide, montants et probabilité par ??, dates au format input', () => {
  const f = leadToForm({
    first_name: null, last_name: 'Durand', email: undefined, order_amount_ht: 0, estimated_revenue: null,
    probability: 0, next_action_date: '2026-11-03T00:00:00+00:00', appointment_date: null,
    quote_sent_date: '2026-10-01', won_date: undefined, email_sent: null, status_id: 'st-2',
  });
  assert.equal(f.first_name, '');
  assert.equal(f.last_name, 'Durand');
  assert.equal(f.email, '');
  assert.equal(f.order_amount_ht, 0, 'un montant à 0 reste 0 (??, pas ||)');
  assert.equal(f.estimated_revenue, '');
  assert.equal(f.probability, 0);
  assert.equal(f.next_action_date, '2026-11-03');
  assert.equal(f.appointment_date, '');
  assert.equal(f.quote_sent_date, '2026-10-01');
  assert.equal(f.won_date, '');
  assert.equal(f.email_sent, false);
  assert.equal(f.status_id, 'st-2');
  assert.deepEqual(Object.keys(f).sort(), Object.keys(EMPTY_LEAD_FORM).sort(), 'mêmes champs que le formulaire vide');
});

test('newLeadForm : formulaire vide + statut d\'entrée + commercial par défaut', () => {
  assert.deepEqual(newLeadForm({ statusId: 'st-nouveau', assignedUserId: 'com-1' }), {
    ...EMPTY_LEAD_FORM, status_id: 'st-nouveau', assigned_user_id: 'com-1',
  });
  assert.equal(newLeadForm().status_id, '');
  assert.equal(EMPTY_LEAD_FORM.probability, '50');
});

// ---------------------------------------------------------------------------
// eventForm
// ---------------------------------------------------------------------------

const rdv = {
  subject: 'Entretien — Durand', appointment_type: 'maintenance', priority: 'high', status: 'confirmed',
  client_name: 'Durand', client_first_name: 'Paul', client_phone: '0612345678', client_email: null,
  address: '3 place du Griffoul', city: 'Gaillac', postal_code: '81600',
  scheduled_date: '2026-11-05', scheduled_start: '09:30:00', scheduled_end: '11:00:00', duration_minutes: 90,
  description: null, internal_notes: 'Chien', technician_ids: ['t1', 't2'], assigned_commercial_id: null,
  time_flex_minutes: 0, hour_confirmed_at: '2026-10-30T10:00:00Z', client_id: 'c1', lead_id: null,
};

test('appointmentToForm : adresse → client_*, heures tronquées à HH:MM, défauts', () => {
  assert.deepEqual(appointmentToForm(rdv), {
    subject: 'Entretien — Durand', appointment_type: 'maintenance', priority: 'high', status: 'confirmed',
    client_name: 'Durand', client_first_name: 'Paul', client_phone: '0612345678', client_email: '',
    client_address: '3 place du Griffoul', client_city: 'Gaillac', client_postal_code: '81600',
    scheduled_date: '2026-11-05', scheduled_start: '09:30', scheduled_end: '11:00', duration_minutes: 90,
    description: '', internal_notes: 'Chien', technicianIds: ['t1', 't2'], assigned_commercial_id: '',
    time_flex_minutes: 0, hour_confirmed_at: '2026-10-30T10:00:00Z',
  });
  const vide = appointmentToForm({});
  assert.equal(vide.appointment_type, 'rdv_technical');
  assert.equal(vide.priority, 'normal');
  assert.equal(vide.status, 'scheduled');
  assert.equal(vide.duration_minutes, 60);
  assert.equal(vide.time_flex_minutes, null);
  assert.deepEqual(vide.technicianIds, []);
});

test('newEventForm : « Autre » par défaut, type figé du kanban, 1 h depuis l\'heure cliquée, client pré-lié', () => {
  const f = newEventForm({ defaultDate: '2026-11-06', defaultTime: '14:30', prefillClient: { last_name: 'Martin', first_name: 'Léa', city: 'Albi' } });
  assert.equal(f.appointment_type, 'other');
  assert.equal(f.scheduled_date, '2026-11-06');
  assert.equal(f.scheduled_start, '14:30');
  assert.equal(f.scheduled_end, '15:30');
  assert.equal(f.duration_minutes, 60);
  assert.equal(f.client_name, 'Martin');
  assert.equal(f.client_first_name, 'Léa');
  assert.equal(f.client_city, 'Albi');
  assert.equal(f.client_phone, '');
  const k = newEventForm({ defaultDate: '2026-11-06', lockedType: 'installation' });
  assert.equal(k.appointment_type, 'installation');
  assert.equal(k.scheduled_start, '09:00');
  assert.equal(k.scheduled_end, '10:00');
  assert.deepEqual(Object.keys(f).sort(), Object.keys(appointmentToForm(rdv)).sort(), 'création et édition ont les mêmes champs');
});

test('applyFieldChange : début / durée recalculent la fin, la fin recalcule la durée, le reste ne bouge pas', () => {
  const base = { scheduled_start: '09:00', duration_minutes: 60, scheduled_end: '10:00', subject: '' };
  assert.equal(applyFieldChange(base, 'scheduled_start', '14:30').scheduled_end, '15:30');
  assert.equal(applyFieldChange(base, 'duration_minutes', '90').scheduled_end, '10:30');
  assert.equal(applyFieldChange(base, 'scheduled_end', '10:45').duration_minutes, 105);
  assert.deepEqual(applyFieldChange(base, 'subject', 'X'), { ...base, subject: 'X' });
  assert.equal(applyFieldChange({ ...base, scheduled_start: '' }, 'scheduled_end', '11:00').duration_minutes, 60, 'sans début, la fin ne recalcule rien');
  assert.notEqual(applyFieldChange(base, 'subject', 'X'), base, 'nouvel objet (setState)');
});

const formOk = {
  scheduled_date: '2026-11-05', scheduled_start: '09:00', client_name: 'Durand', appointment_type: 'maintenance',
  technicianIds: ['t1'], assigned_commercial_id: '', client_phone: '',
};
const opts = { isFreeType: false, isCommercialType: false, commercialMemberId: null, isEdit: false, originalType: undefined };

test('validateEventForm : champs requis, une personne obligatoire', () => {
  assert.deepEqual(validateEventForm(formOk, opts), { errors: {}, phoneMissing: false });
  const { errors } = validateEventForm({ ...formOk, scheduled_date: '', scheduled_start: '', client_name: '  ', appointment_type: '', technicianIds: [] }, opts);
  assert.deepEqual(errors, {
    scheduled_date: 'Date requise', scheduled_start: 'Heure de début requise', client_name: 'Nom requis',
    appointment_type: 'Type requis', technicianIds: 'Une personne est requise',
  });
  // un commercial suffit pour un RDV technique (legacy)
  assert.deepEqual(validateEventForm({ ...formOk, technicianIds: [], assigned_commercial_id: 'com-1' }, opts).errors, {});
  // « Autre » / « Congés » : nom facultatif
  assert.deepEqual(validateEventForm({ ...formOk, client_name: '' }, { ...opts, isFreeType: true }).errors, {});
});

test('validateEventForm : RDV commercial = assigned_commercial_id ou commercial résolu', () => {
  const vt = { ...formOk, appointment_type: 'rdv_technical', technicianIds: [], client_phone: '0612345678' };
  const c = { ...opts, isCommercialType: true };
  assert.deepEqual(validateEventForm(vt, c).errors, { assigned_commercial_id: 'Une personne est requise' });
  assert.deepEqual(validateEventForm(vt, { ...c, commercialMemberId: 'tm-3' }).errors, {});
  assert.deepEqual(validateEventForm({ ...vt, assigned_commercial_id: 'com-1' }, c).errors, {});
});

test('validateEventForm : téléphone exigé à la pose d\'une VT ou à la re-catégorisation, pas sur une VT déjà posée', () => {
  const vt = { ...formOk, appointment_type: 'rdv_technical', assigned_commercial_id: 'com-1' };
  const c = { ...opts, isCommercialType: true };
  const pose = validateEventForm(vt, c);
  assert.equal(pose.phoneMissing, true);
  assert.equal(pose.errors.client_phone, 'Téléphone requis pour ce type de RDV');
  assert.equal(validateEventForm(vt, { ...c, isEdit: true, originalType: 'rdv_technical' }).phoneMissing, false, 'VT déjà posée : reste éditable');
  assert.equal(validateEventForm(vt, { ...c, isEdit: true, originalType: 'other' }).phoneMissing, true, 'Autre → VT : numéro exigé');
  assert.equal(validateEventForm({ ...vt, client_phone: '06 12 34 56 78' }, c).phoneMissing, false);
});

test('dupDecisionOf : seules les décisions du dialogue doublon comptent (un event de clic n\'en est pas une)', () => {
  assert.deepEqual(dupDecisionOf({ action: 'link', leadId: 'l1' }), { action: 'link', leadId: 'l1' });
  assert.deepEqual(dupDecisionOf({ action: 'create' }), { action: 'create' });
  assert.equal(dupDecisionOf({ type: 'click', target: {} }), null);
  assert.equal(dupDecisionOf(undefined), null);
});

test('objet automatique : « Type — Nom Prénom », type seul sans client', () => {
  assert.equal(clientLabelOf({ client_name: 'Durand', client_first_name: 'Paul' }), 'Durand Paul');
  assert.equal(clientLabelOf({ client_name: '', client_first_name: '' }), '');
  assert.equal(autoSubjectFor('Entretien', { client_name: 'Durand', client_first_name: 'Paul' }), 'Entretien — Durand Paul');
  assert.equal(autoSubjectFor('Visite technique', { client_name: '', client_first_name: '' }), 'Visite technique');
});

test('contactFromRecord / EMPTY_CONTACT : coordonnées recopiées d\'une fiche ou d\'une carte, nom de repli', () => {
  assert.deepEqual(contactFromRecord({ display_name: 'SCI Les Tilleuls', phone: '0563000000', city: 'Albi' }, { nameFallback: 'SCI Les Tilleuls' }), {
    client_name: 'SCI Les Tilleuls', client_first_name: '', client_phone: '0563000000', client_email: '',
    client_address: '', client_postal_code: '', client_city: 'Albi',
  });
  assert.equal(contactFromRecord({ last_name: 'Martin', display_name: 'X' }, { nameFallback: 'X' }).client_name, 'Martin');
  assert.equal(contactFromRecord({}).client_name, '');
  assert.deepEqual(Object.keys(EMPTY_CONTACT).sort(), Object.keys(contactFromRecord({})).sort());
});

test('liaisons restaurées : client et carte depuis le RDV, client depuis la fiche (création)', () => {
  assert.deepEqual(linkedClientFromAppointment(rdv), { id: 'c1', display_name: 'Durand', client_number: null, phone: '0612345678', city: 'Gaillac' });
  assert.equal(linkedClientFromAppointment({ ...rdv, client_id: null }), null);
  assert.equal(linkedLeadFromAppointment(rdv), null);
  assert.deepEqual(linkedLeadFromAppointment({ ...rdv, lead_id: 'l7' }), {
    id: 'l7', display_name: 'Durand', first_name: null, last_name: null, status_label: null, source_name: null, client_id: 'c1',
  });
  assert.deepEqual(linkedClientFromPrefill({ id: 'c2', last_name: 'Martin', first_name: 'Léa' }), {
    id: 'c2', display_name: 'Martin Léa', client_number: null, phone: null, city: null,
  });
  assert.equal(linkedClientFromPrefill({ last_name: 'Sans id' }), null);
  assert.equal(linkedClientFromPrefill(null), null);
});
