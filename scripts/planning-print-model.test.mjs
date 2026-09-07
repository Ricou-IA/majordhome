import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoWeekNumber, formatWeekRange, buildWeeklyPlanningModel, buildPlanningFilename,
} from '../src/lib/planningPrintModel.js';
import { buildEquipmentLabelsByClient } from '../src/lib/equipmentIcons.js';

const TYPE_LABELS = { maintenance: 'Entretien', installation: 'Installation', rdv_technical: 'Visite Technique R1' };

const person = { profileKey: 'p-moh', displayName: 'Mohammed Ben', color: '#22C55E' };

const rdv = (over) => ({
  id: 'a1', appointment_type: 'maintenance', status: 'scheduled',
  scheduled_date: '2026-09-08', scheduled_start: '08:30:00', scheduled_end: '10:00:00',
  client_id: 'c1', client_name: 'GARDERES', client_first_name: 'Brigitte',
  address: '12 chemin des Vignes', postal_code: '81800', city: 'Rabastens',
  client_phone: '0612345678', grand_secteur: 'ASQUES',
  subject: 'Entretien — GARDERES Brigitte', description: null, target_invoiced: false,
  ...over,
});

test('isoWeekNumber : lundi 7 sept. 2026 = S37', () => {
  assert.equal(isoWeekNumber(new Date(2026, 8, 7)), 37);
  assert.equal(isoWeekNumber(new Date(2026, 0, 1)), 1);
});

test('formatWeekRange : même mois, puis à cheval sur deux mois', () => {
  assert.equal(formatWeekRange('2026-09-07', '2026-09-11'), '7 au 11 septembre 2026');
  assert.equal(formatWeekRange('2026-09-28', '2026-10-02'), '28 septembre au 2 octobre 2026');
});

test('buildPlanningFilename : slug sans accent + semaine + lundi', () => {
  assert.equal(buildPlanningFilename('Éric Pudebat', 37, '2026-09-07'), 'planning-eric-pudebat-S37-2026-09-07.pdf');
});

test('modèle : 5 jours lun→ven toujours présents, RDV triés, annulés exclus, doublons dédupliqués', () => {
  const m = buildWeeklyPlanningModel({
    appointments: [
      rdv({ id: 'a2', scheduled_start: '11:00:00', scheduled_end: '12:30:00', client_name: 'BLUMSTEIN' }),
      rdv(),
      rdv(), // même id → dédupliqué (bloc multi-tech côté calendrier)
      rdv({ id: 'a3', status: 'cancelled', scheduled_date: '2026-09-09' }),
      rdv({ id: 'a4', scheduled_date: '2026-09-14' }), // hors semaine
    ],
    person, weekStart: '2026-09-07', typeLabels: TYPE_LABELS,
    equipmentLabelsByClient: new Map(), now: new Date(2026, 8, 7, 15, 0),
  });
  assert.equal(m.personName, 'Mohammed Ben');
  assert.equal(m.weekNumber, 37);
  assert.equal(m.weekLabel, '7 au 11 septembre 2026');
  assert.equal(m.editedLabel, 'Édité le 7 septembre 2026 à 15:00');
  assert.deepEqual(m.days.map((d) => d.label), [
    'Lundi 7 septembre', 'Mardi 8 septembre', 'Mercredi 9 septembre', 'Jeudi 10 septembre', 'Vendredi 11 septembre',
  ]);
  assert.deepEqual(m.days.map((d) => d.items.length), [0, 2, 0, 0, 0]);
  assert.deepEqual(m.days[1].items.map((i) => i.id), ['a1', 'a2']);
  assert.equal(m.totalCount, 2);
  assert.equal(m.filename, 'planning-mohammed-ben-S37-2026-09-07.pdf');
});

test('modèle : mise en forme d’une carte (heure, type, nom, secteur, adresse, tél, équipements)', () => {
  const m = buildWeeklyPlanningModel({
    appointments: [rdv()], person, weekStart: '2026-09-07', typeLabels: TYPE_LABELS,
    equipmentLabelsByClient: new Map([['c1', ['Poêle à granulés', 'PAC air/air']]]),
  });
  const it = m.days[1].items[0];
  assert.equal(it.time, '8:30 – 10:00');
  assert.equal(it.typeLabel, 'Entretien');
  assert.equal(it.clientName, 'GARDERES Brigitte');
  assert.equal(it.sector, 'ASQUES');
  assert.equal(it.address, '12 chemin des Vignes, 81800 Rabastens');
  assert.equal(it.phone, '06 12 34 56 78');
  assert.deepEqual(it.equipments, ['Poêle à granulés', 'PAC air/air']);
  assert.equal(it.subject, null, 'objet auto (« Type — Client ») masqué');
  assert.equal(it.color, '#22C55E');
});

test('modèle : objet libre conservé, description conservée, facturé = violet, champs vides tolérés', () => {
  const m = buildWeeklyPlanningModel({
    appointments: [rdv({
      subject: 'Remplacer le joint de porte', description: 'Prévoir échelle',
      target_invoiced: true, address: null, postal_code: null, city: 'Gaillac',
      client_phone: null, client_first_name: null, grand_secteur: null, scheduled_end: null,
    })],
    person, weekStart: '2026-09-07', typeLabels: TYPE_LABELS, equipmentLabelsByClient: new Map(),
  });
  const it = m.days[1].items[0];
  assert.equal(it.subject, 'Remplacer le joint de porte');
  assert.equal(it.description, 'Prévoir échelle');
  assert.equal(it.color, '#6D28D9');
  assert.equal(it.address, 'Gaillac');
  assert.equal(it.phone, null);
  assert.equal(it.clientName, 'GARDERES');
  assert.equal(it.sector, null);
  assert.equal(it.time, '8:30');
  assert.deepEqual(it.equipments, []);
});

test('modèle : samedi ajouté seulement s’il porte un RDV ; type inconnu → libellé brut', () => {
  const m = buildWeeklyPlanningModel({
    appointments: [rdv({ scheduled_date: '2026-09-12', appointment_type: 'other' })],
    person, weekStart: '2026-09-07', typeLabels: TYPE_LABELS, equipmentLabelsByClient: new Map(),
  });
  assert.equal(m.days.length, 6);
  assert.equal(m.days[5].label, 'Samedi 12 septembre');
  assert.equal(m.days[5].items[0].typeLabel, 'other');
});

test('buildEquipmentLabelsByClient : tous les équipements, même sans icône, libellé ou catégorie', () => {
  const map = buildEquipmentLabelsByClient([
    { client_id: 'c1', type_code: 'poele_granules_elec', category: 'poele', type_label: 'Poêle à granulés' },
    { client_id: 'c1', type_code: 'poele_hydro', category: 'poele', type_label: 'Poêle hydro' },
    { client_id: 'c2', type_code: null, category: 'chaudiere_gaz', type_label: null },
    { client_id: null, type_label: 'orphelin' },
  ]);
  assert.deepEqual(map.get('c1'), ['Poêle à granulés', 'Poêle hydro']);
  assert.deepEqual(map.get('c2'), ['chaudiere_gaz']);
  assert.equal(map.size, 2);
});
