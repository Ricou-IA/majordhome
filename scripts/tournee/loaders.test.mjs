// scripts/tournee/loaders.test.mjs
// Chargement injectable des données du moteur (src/lib/tournee/loaders.js) :
// journées de l'horizon et contrat à proposer, avec un faux client supabase.
// Run : node --test scripts/tournee/loaders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerJournees, chargerContrat } from '../../src/lib/tournee/loaders.js';

/**
 * Faux client : chaque table renvoie ses lignes quel que soit le filtre.
 * `maybeSingle()` renvoie la première ligne. Enregistre les tables lues.
 */
function fauxClient(tables) {
  const lues = [];
  return {
    lues,
    from(table) {
      lues.push(table);
      const rows = tables[table] ?? [];
      const q = {
        select() { return q; },
        eq() { return q; },
        in() { return q; },
        gte() { return q; },
        lte() { return q; },
        not() { return q; },
        order() { return q; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return q;
    },
  };
}
const LUNDI = new Date('2026-09-14T08:00:00Z');
const silencieux = { error() {}, warn() {} };

test('chargerJournees : une journée par technicien × jour ouvré, RDV coordonnés via le client, compétences par rôle portées', async () => {
  const client = fauxClient({
    majordhome_team_members: [{
      id: 't1', display_name: 'Antoine', calendar_color: '#f00', daily_work_minutes: 480, include_in_routing: true,
      default_availability: { monday: { active: true, start: '08:00', end: '18:00' }, tuesday: { active: false } },
    }],
    majordhome_team_member_skills: [
      { team_member_id: 't1', equipment_type_id: 'clim', role: 'entretien' },
      { team_member_id: 't1', equipment_type_id: 'poele_g', role: 'entretien' },
      { team_member_id: 't1', equipment_type_id: 'clim', role: 'pose' },
      { team_member_id: 't1', equipment_type_id: 'x', role: 'inconnu' }, // rôle hors liste : ignoré
    ],
    majordhome_appointments: [{
      id: 'r1', client_id: 'c1', lead_id: null, scheduled_date: '2026-09-14', scheduled_start: '08:00',
      duration_minutes: 90, appointment_type: 'maintenance', client_name: 'DUPONT', address: null, city: 'GAILLAC',
      postal_code: '81600', status: 'confirmed',
    }],
    majordhome_clients: [{ id: 'c1', latitude: 43.9, longitude: 1.9 }],
    majordhome_leads: [],
    majordhome_appointment_technicians: [{ appointment_id: 'r1', technician_id: 't1' }],
  });
  const { data, techniciens, error } = await chargerJournees({
    client, coreOrgId: 'core', mdhOrgId: 'mdh', joursApres: 1, maintenant: LUNDI, logger: silencieux,
  });
  assert.equal(error, null);
  assert.equal(data.length, 1);                       // lundi oui, mardi inactif
  assert.equal(data[0].date, '2026-09-14');
  assert.equal(data[0].technicienId, 't1');
  assert.equal(data[0].technicienNom, 'Antoine');
  assert.deepEqual(data[0].amplitude, { debut: 480, fin: 1080 });
  assert.equal(data[0].budgetMinutes, 480);
  assert.equal(data[0].rdvs.length, 1);
  assert.equal(data[0].rdvs[0].lat, 43.9);
  assert.equal(data[0].chargeMinutes, 90);
  assert.equal(data[0].estAmorcee, true);
  assert.deepEqual(data[0].competences, { entretien: ['clim', 'poele_g'], pose: ['clim'] });
  assert.deepEqual(techniciens, [{ id: 't1', nom: 'Antoine', competences: { entretien: ['clim', 'poele_g'], pose: ['clim'] }, couleur: '#f00' }]);
  assert.ok(client.lues.includes('majordhome_team_member_skills'));
});

test('chargerJournees : un RDV rattaché à un lead prend les coordonnées du lead ; sans rien, lat/lng null (jamais écarté)', async () => {
  const client = fauxClient({
    majordhome_team_members: [{
      id: 't1', display_name: 'A', calendar_color: null, daily_work_minutes: 480, include_in_routing: true,
      default_availability: { monday: { active: true, start: '08:00', end: '17:00' } },
    }],
    majordhome_appointments: [
      { id: 'r1', client_id: null, lead_id: 'l1', scheduled_date: '2026-09-14', scheduled_start: '09:00', duration_minutes: 60, appointment_type: 'installation', status: 'confirmed' },
      { id: 'r2', client_id: null, lead_id: null, scheduled_date: '2026-09-14', scheduled_start: '14:00', duration_minutes: 60, appointment_type: 'maintenance', status: 'confirmed' },
    ],
    majordhome_clients: [],
    majordhome_leads: [{ id: 'l1', latitude: 43.5, longitude: 2.1 }],
    majordhome_appointment_technicians: [{ appointment_id: 'r1', technician_id: 't1' }, { appointment_id: 'r2', technician_id: 't1' }],
  });
  const { data } = await chargerJournees({ client, coreOrgId: 'core', mdhOrgId: 'mdh', joursApres: 0, maintenant: LUNDI, logger: silencieux });
  assert.equal(data.length, 1);
  const parId = Object.fromEntries(data[0].rdvs.map((r) => [r.id, r]));
  assert.equal(parId.r1.lat, 43.5);
  assert.equal(parId.r2.lat, null);
  assert.equal(data[0].chargeMinutes, 120);
  // aucune ligne de compétence : rien coché pour chaque rôle (jamais proposé), pas « polyvalent »
  assert.deepEqual(data[0].competences, { entretien: [], pose: [] });
});

test('chargerContrat : durée barémée + exigences (type) + catégories libellées + coordonnées du client', async () => {
  const client = fauxClient({
    majordhome_contracts: [{ id: 'k1', client_id: 'c1', client_name: 'DUPONT', client_city: 'CASTRES', client_postal_code: '81100', start_date: '2025-06-01' }],
    majordhome_pricing_equipment_types: [
      { id: 'ty1', code: 'CLIM', category_id: 'cat_clim', duration_base_minutes: 60, duration_per_extra_unit_minutes: 20, included_units: 1, unfavorable_months: [] },
      { id: 'ty2', code: 'GAINABLE', category_id: 'cat_clim', duration_base_minutes: 90, duration_per_extra_unit_minutes: 0, included_units: 1, unfavorable_months: [] },
    ],
    majordhome_equipment_categories: [{ id: 'cat_clim', code: 'climatisation', label: 'Climatisation' }],
    majordhome_clients: [{ id: 'c1', latitude: 43.6, longitude: 2.24 }],
    majordhome_contract_equipments: [{ contract_id: 'k1', equipment_id: 'e1' }],
    majordhome_equipments: [{ id: 'e1', category_id: 'cat_clim', unit_count: 2, equipment_type_id: 'ty1' }],
  });
  const { data, error } = await chargerContrat({ client, coreOrgId: 'core', contractId: 'k1' });
  assert.equal(error, null);
  assert.equal(data.id, 'k1');
  assert.equal(data.clientName, 'DUPONT');
  assert.equal(data.ville, 'CASTRES');
  assert.equal(data.dureeMinutes, 80);                 // 60 + (2 − 1) × 20
  assert.deepEqual(data.exigences, [{ typeId: 'ty1' }]);
  assert.deepEqual(data.categories, [{ id: 'cat_clim', code: 'climatisation', label: 'Climatisation' }]);
  assert.deepEqual([...data.typesParCategorie.entries()], [['cat_clim', ['ty1', 'ty2']]]);
  assert.equal(data.lat, 43.6);
  assert.equal(data.typesNonRenseignes, 0);
});

test('chargerContrat : équipement sans type → durée par défaut (90), exigence par catégorie, compté dans typesNonRenseignes', async () => {
  const client = fauxClient({
    majordhome_contracts: [{ id: 'k1', client_id: 'c1', client_name: 'X', client_city: null, client_postal_code: null, start_date: null }],
    majordhome_pricing_equipment_types: [],
    majordhome_equipment_categories: [{ id: 'cat_poele', code: 'poele', label: 'Poêle' }],
    majordhome_clients: [{ id: 'c1', latitude: null, longitude: null }],
    majordhome_contract_equipments: [{ contract_id: 'k1', equipment_id: 'e1' }, { contract_id: 'k1', equipment_id: 'e2' }],
    majordhome_equipments: [
      { id: 'e1', category_id: 'cat_poele', unit_count: 1, equipment_type_id: null },
      { id: 'e2', category_id: null, unit_count: 1, equipment_type_id: null },      // non catégorisé : aucune exigence
    ],
  });
  const { data } = await chargerContrat({ client, coreOrgId: 'core', contractId: 'k1' });
  assert.equal(data.dureeMinutes, 180);                // 2 × 90 par défaut
  assert.equal(data.typesNonRenseignes, 2);
  assert.deepEqual(data.exigences, [{ categoryId: 'cat_poele' }]);
  assert.deepEqual(data.categories, [{ id: 'cat_poele', code: 'poele', label: 'Poêle' }]);
  assert.equal(data.lat, null);
});

test('chargerContrat : contrat introuvable → error contrat_introuvable, data null', async () => {
  const client = fauxClient({ majordhome_contracts: [], majordhome_pricing_equipment_types: [] });
  const { data, error } = await chargerContrat({ client, coreOrgId: 'core', contractId: 'nope' });
  assert.equal(data, null);
  assert.equal(error.message, 'contrat_introuvable');
});

test('R1 (bloc contrat) : un Entretien à contrat porte la durée barème × gain, pas le bloc dessiné ; SAV et sans contrat gardent leur durée', async () => {
  const client = fauxClient({
    majordhome_team_members: [{
      id: 't1', display_name: 'Antoine', calendar_color: '#f00', daily_work_minutes: 480, include_in_routing: true, specialties: [],
      default_availability: { tuesday: { active: true, start: '08:00', end: '18:00' } },
    }],
    majordhome_appointments: [
      { id: 'gomes', client_id: 'c1', lead_id: null, intervention_id: 'i1', scheduled_date: '2026-09-15', scheduled_start: '12:30', duration_minutes: 270, appointment_type: 'maintenance', status: 'scheduled' },
      { id: 'sav', client_id: 'c2', lead_id: null, intervention_id: 'i2', scheduled_date: '2026-09-15', scheduled_start: '08:00', duration_minutes: 120, appointment_type: 'service', status: 'scheduled' },
      { id: 'libre', client_id: 'c3', lead_id: null, intervention_id: null, scheduled_date: '2026-09-15', scheduled_start: '16:00', duration_minutes: 45, appointment_type: 'maintenance', status: 'scheduled' },
    ],
    majordhome_clients: [{ id: 'c1', latitude: 43.94, longitude: 1.72 }, { id: 'c2', latitude: 43.9, longitude: 1.9 }, { id: 'c3', latitude: 43.8, longitude: 1.6 }],
    majordhome_leads: [],
    majordhome_appointment_technicians: [{ appointment_id: 'gomes', technician_id: 't1' }, { appointment_id: 'sav', technician_id: 't1' }, { appointment_id: 'libre', technician_id: 't1' }],
    majordhome_interventions: [{ id: 'i1', contract_id: 'ct1' }, { id: 'i2', contract_id: 'ct2' }],
    majordhome_contract_equipments: [
      { contract_id: 'ct1', equipment_id: 'e1' }, { contract_id: 'ct1', equipment_id: 'e2' }, { contract_id: 'ct1', equipment_id: 'e3' }, { contract_id: 'ct1', equipment_id: 'e4' },
    ],
    majordhome_pricing_equipment_types: [
      { id: 'clim', code: 'CLIM', category: 'pac_air_air', duration_base_minutes: 60, duration_per_extra_unit_minutes: 30, included_units: 1 },
      { id: 'bois', code: 'BOIS', category: 'poele', duration_base_minutes: 60, duration_per_extra_unit_minutes: 0, included_units: 1 },
    ],
    majordhome_equipments: [
      { id: 'e1', category: 'pac_air_air', unit_count: 1, equipment_type_id: 'clim' },
      { id: 'e2', category: 'pac_air_air', unit_count: 1, equipment_type_id: 'clim' },
      { id: 'e3', category: 'pac_air_air', unit_count: 1, equipment_type_id: 'clim' },
      { id: 'e4', category: 'poele', unit_count: 1, equipment_type_id: 'bois' },
    ],
  });
  const { data, error } = await chargerJournees({
    client, coreOrgId: 'core', mdhOrgId: 'mdh', joursApres: 1, maintenant: LUNDI, logger: silencieux,
    reglages: { gain_multi_equipements_pct: 10 },
  });
  assert.equal(error, null);
  const j = data.find((x) => x.date === '2026-09-15');
  const par = Object.fromEntries(j.rdvs.map((r) => [r.id, r]));
  assert.equal(par.gomes.duration_minutes, 216, '4 équipements : (60×3 + 60) × 0,9');
  assert.equal(par.gomes.duration_minutes_saisie, 270, 'le bloc dessiné reste lisible');
  assert.equal(par.sav.duration_minutes, 120, 'un SAV n a pas de barème');
  assert.equal(par.libre.duration_minutes, 45, 'sans contrat : durée saisie');
  assert.equal(j.chargeMinutes, 216 + 120 + 45);
});
