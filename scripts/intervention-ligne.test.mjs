// scripts/intervention-ligne.test.mjs — lignes de l'onglet Interventions de la fiche client
// node --test scripts/intervention-ligne.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrireIntervention, rdvDeReference, rdvsActifs, ordonnerInterventions } from '../src/lib/interventionLigne.js';

const AUJOURDHUI = '2026-11-16';
const NOMS = new Map([['t1', 'Michel'], ['t2', 'Philippe']]);

test('demande SAV sans date ni RDV : on montre la date de la demande et sa description', () => {
  // Cas ABADIE (CLI-00516) : cinq lignes « SAV · Demande » suivies d'un tiret.
  const ligne = decrireIntervention({
    intervention_type: 'sav', workflow_status: 'demande', status: 'scheduled',
    scheduled_date: null, created_at: '2026-11-11T08:58:03Z', sav_description: ' blabla ', rdvs: [],
  }, { aujourdhui: AUJOURDHUI, nomsTechniciens: NOMS });
  assert.deepEqual(ligne.moment, { kind: 'demande', date: '2026-11-11T08:58:03Z', heure: null });
  assert.equal(ligne.demandeLe, null, 'la date de demande est déjà le moment affiché');
  assert.equal(ligne.objet, 'blabla');
  assert.deepEqual(ligne.techniciens, []);
});

test('RDV à venir : date, heure et techniciens du RDV', () => {
  const ligne = decrireIntervention({
    intervention_type: 'entretien', workflow_status: 'planifie', scheduled_date: '2026-11-20',
    created_at: '2026-10-01T10:00:00Z',
    rdvs: [{ scheduled_date: '2026-11-20', scheduled_start: '09:30:00', status: 'scheduled', technician_ids: ['t2', 't1', 't2'] }],
  }, { aujourdhui: AUJOURDHUI, nomsTechniciens: NOMS });
  assert.deepEqual(ligne.moment, { kind: 'rdv_a_venir', date: '2026-11-20', heure: '09:30' });
  assert.deepEqual(ligne.techniciens, ['Philippe', 'Michel']);
  assert.equal(ligne.demandeLe, '2026-10-01T10:00:00Z');
  assert.equal(ligne.objet, null, 'un entretien n’a pas de description de SAV');
});

test('le RDV du jour compte comme à venir ; sinon le dernier passé fait référence', () => {
  const rdvs = [
    { scheduled_date: '2026-11-10', scheduled_start: '08:00', status: 'completed' },
    { scheduled_date: '2026-11-16', scheduled_start: '14:00', status: 'scheduled' },
    { scheduled_date: '2026-11-25', scheduled_start: '08:00', status: 'scheduled' },
  ];
  assert.equal(rdvDeReference(rdvs, AUJOURDHUI).scheduled_date, '2026-11-16');
  assert.equal(rdvDeReference(rdvs.slice(0, 1), AUJOURDHUI).scheduled_date, '2026-11-10');
  assert.equal(decrireIntervention({ rdvs: rdvs.slice(0, 1) }, { aujourdhui: AUJOURDHUI }).moment.kind, 'rdv_passe');
  assert.equal(decrireIntervention({ rdvs }, { aujourdhui: AUJOURDHUI }).joursDeRdv, 3);
});

test('un RDV annulé ou un client absent ne fait pas un passage', () => {
  const rdvs = [
    { scheduled_date: '2026-11-18', status: 'cancelled' },
    { scheduled_date: '2026-11-12', status: 'no_show' },
  ];
  assert.deepEqual(rdvsActifs(rdvs), []);
  assert.equal(rdvDeReference(rdvs, AUJOURDHUI), null);
  const ligne = decrireIntervention({ intervention_type: 'sav', created_at: '2026-11-01T00:00:00Z', rdvs }, { aujourdhui: AUJOURDHUI });
  assert.equal(ligne.moment.kind, 'demande');
});

test('historique importé : une date sans RDV, réalisée ou seulement prévue', () => {
  const faite = decrireIntervention({ intervention_type: 'maintenance', status: 'completed', scheduled_date: '2025-03-04' }, { aujourdhui: AUJOURDHUI });
  assert.deepEqual(faite.moment, { kind: 'realise', date: '2025-03-04', heure: null });
  const prevue = decrireIntervention({ intervention_type: 'entretien', workflow_status: 'planifie', status: 'scheduled', scheduled_date: '2026-12-01' }, { aujourdhui: AUJOURDHUI });
  assert.equal(prevue.moment.kind, 'prevu');
  const realisee = decrireIntervention({ intervention_type: 'entretien', workflow_status: 'realise', status: 'scheduled', scheduled_date: '2026-10-01' }, { aujourdhui: AUJOURDHUI });
  assert.equal(realisee.moment.kind, 'realise');
});

test('technicien inconnu de l’équipe active : ignoré, jamais un identifiant à l’écran', () => {
  const ligne = decrireIntervention({
    technician_name: null,
    rdvs: [{ scheduled_date: '2026-11-20', status: 'scheduled', technician_ids: ['parti', 't1'] }],
  }, { aujourdhui: AUJOURDHUI, nomsTechniciens: NOMS });
  assert.deepEqual(ligne.techniciens, ['Michel']);
  // Repli sur le nom porté par l'intervention quand le RDV ne dit rien.
  const repli = decrireIntervention({ technician_name: 'Ancien', rdvs: [] }, { aujourdhui: AUJOURDHUI });
  assert.deepEqual(repli.techniciens, ['Ancien']);
});

test('textes vides : null, pas une ligne blanche', () => {
  const ligne = decrireIntervention({ intervention_type: 'sav', sav_description: '  ', work_performed: '', report_notes: null }, { aujourdhui: AUJOURDHUI });
  assert.equal(ligne.objet, null);
  assert.equal(ligne.compteRendu, null);
  assert.equal(ligne.notes, null);
});

test('ordre : la plus récente en tête, les enfants sous leur parent, les orphelins gardés', () => {
  const liste = [
    { id: 'ancien', scheduled_date: '2025-01-10', created_at: '2025-01-01T00:00:00Z' },
    { id: 'enfant', parent_id: 'recent' },
    { id: 'recent', scheduled_date: null, created_at: '2026-11-11T00:00:00Z' },
    { id: 'planifie', scheduled_date: '2026-06-01', created_at: '2026-01-01T00:00:00Z', rdvs: [{ scheduled_date: '2026-12-01', status: 'scheduled' }] },
    { id: 'orphelin', parent_id: 'absent' },
  ];
  const copie = [...liste];
  const ordre = ordonnerInterventions(liste, AUJOURDHUI);
  assert.deepEqual(ordre.map((i) => i.id), ['planifie', 'recent', 'enfant', 'ancien', 'orphelin']);
  assert.equal(ordre[1]._hasChildren, true);
  assert.equal(ordre[0]._hasChildren, false);
  assert.deepEqual(liste, copie, 'le tableau reçu n’est pas modifié');
});
