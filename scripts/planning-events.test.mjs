import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentKind, buildPersonColorMaps, resolveAppointmentColor,
  buildTeamList, matchesKindFilter, matchesMemberFilter, expandAppointmentBlocks,
  INVOICED_EVENT_COLOR, FALLBACK_PERSON_COLOR,
} from '../src/lib/planningEvents.js';

// Fixtures inspirées des vraies données Mayer (Philippe = tech + commercial).
const members = [
  { id: 'tm-ludo', user_id: 'p-ludo', display_name: 'Ludovic Robert', calendar_color: '#EF4444' },
  { id: 'tm-phil', user_id: 'p-phil', display_name: 'Philippe Mazel', calendar_color: '#3B82F6' },
];
const commercials = [
  { id: 'co-phil', profile_id: 'p-phil', full_name: 'Philippe Mazel' },
];
const maps = buildPersonColorMaps({ members, commercials });

test('appointmentKind: buckets par type', () => {
  assert.equal(appointmentKind('rdv_technical'), 'commercial');
  assert.equal(appointmentKind('rdv_agency'), 'commercial');
  assert.equal(appointmentKind('maintenance'), 'intervention');
  assert.equal(appointmentKind('installation'), 'intervention');
  assert.equal(appointmentKind('other'), 'other');
});

test('resolveAppointmentColor: intervention -> couleur du technicien', () => {
  const appt = { appointment_type: 'maintenance', technician_ids: ['tm-ludo'], assigned_commercial_id: null, target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#EF4444');
});

test('resolveAppointmentColor: VT commerciale -> couleur du commercial (profil partagé)', () => {
  const appt = { appointment_type: 'rdv_technical', technician_ids: [], assigned_commercial_id: 'co-phil', target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#3B82F6');
});

test('resolveAppointmentColor: facturé écrase la couleur personne -> violet', () => {
  const appt = { appointment_type: 'maintenance', technician_ids: ['tm-ludo'], target_invoiced: true };
  assert.equal(resolveAppointmentColor(appt, maps), INVOICED_EVENT_COLOR);
});

test('resolveAppointmentColor: "Autre" -> couleur du propriétaire', () => {
  const appt = { appointment_type: 'other', technician_ids: ['tm-phil'], assigned_commercial_id: null, target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#3B82F6');
});

test('resolveAppointmentColor: non assigné -> fallback', () => {
  const appt = { appointment_type: 'other', technician_ids: [], assigned_commercial_id: null };
  assert.equal(resolveAppointmentColor(appt, maps), FALLBACK_PERSON_COLOR);
});

test('buildTeamList: dédoublonne Philippe (tech + commercial) en 1 humain', () => {
  const list = buildTeamList({ members, commercials });
  const phil = list.filter((h) => h.displayName === 'Philippe Mazel');
  assert.equal(phil.length, 1);
  assert.deepEqual(new Set(phil[0].recordIds), new Set(['tm-phil', 'co-phil']));
  assert.equal(phil[0].color, '#3B82F6');
  assert.equal(phil[0].isTech, true);
  assert.equal(phil[0].isCommercial, true);
});

test('matchesKindFilter: "Autre" toujours visible, buckets respectés', () => {
  assert.equal(matchesKindFilter({ appointment_type: 'other' }, { intervention: false, commercial: false }), true);
  assert.equal(matchesKindFilter({ appointment_type: 'rdv_technical' }, { intervention: true, commercial: false }), false);
  assert.equal(matchesKindFilter({ appointment_type: 'rdv_technical' }, { intervention: true, commercial: true }), true);
  assert.equal(matchesKindFilter({ appointment_type: 'maintenance' }, { intervention: true, commercial: false }), true);
});

test('matchesMemberFilter: match via commercial OU technicien, vide = tout', () => {
  const sel = new Set(['co-phil', 'tm-phil']);
  assert.equal(matchesMemberFilter({ assigned_commercial_id: 'co-phil', technician_ids: [] }, sel), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-phil'] }, sel), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'], assigned_commercial_id: null }, sel), false);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'] }, null), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'] }, new Set()), true);
});

test('expandAppointmentBlocks: intervention multi-tech -> 1 bloc par technicien', () => {
  const appt = { appointment_type: 'installation', technician_ids: ['tm-ludo', 'tm-phil'], target_invoiced: false };
  const blocks = expandAppointmentBlocks(appt, maps, null);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.color), ['#EF4444', '#3B82F6']);
  assert.deepEqual(blocks.map((b) => b.idSuffix), ['tm-ludo', 'tm-phil']);
});

test('expandAppointmentBlocks: filtre actif -> seuls les techniciens visibles', () => {
  const appt = { appointment_type: 'installation', technician_ids: ['tm-ludo', 'tm-phil'], target_invoiced: false };
  const blocks = expandAppointmentBlocks(appt, maps, new Set(['tm-ludo']));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].color, '#EF4444');
  assert.equal(blocks[0].idSuffix, 'tm-ludo');
});

test('expandAppointmentBlocks: mono-tech -> 1 bloc unique (idSuffix null)', () => {
  const appt = { appointment_type: 'maintenance', technician_ids: ['tm-ludo'], target_invoiced: false };
  const blocks = expandAppointmentBlocks(appt, maps, null);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].color, '#EF4444');
  assert.equal(blocks[0].idSuffix, null);
});

test('expandAppointmentBlocks: facturé multi-tech -> 1 bloc violet', () => {
  const appt = { appointment_type: 'installation', technician_ids: ['tm-ludo', 'tm-phil'], target_invoiced: true };
  const blocks = expandAppointmentBlocks(appt, maps, null);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].color, INVOICED_EVENT_COLOR);
});

test('expandAppointmentBlocks: RDV commercial ne se découpe pas', () => {
  const appt = { appointment_type: 'rdv_technical', technician_ids: ['tm-ludo', 'tm-phil'], assigned_commercial_id: 'co-phil', target_invoiced: false };
  const blocks = expandAppointmentBlocks(appt, maps, null);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].idSuffix, null);
});
