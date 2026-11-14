// Tests du CA HT programmé du planning (src/lib/planningCa.js).
// node --test scripts/planning-ca.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleAffaire, indexerJours, tauxTvaContrat, montantHtContrat, caProgramme, formatCa,
} from '../src/lib/planningCa.js';

const pose = (id, date, chantierId, techs, extra = {}) => ({
  id, appointment_type: 'installation', scheduled_date: date, chantier_id: chantierId,
  technician_ids: techs, status: 'scheduled', ...extra,
});
const entretien = (id, date, interventionId, techs, extra = {}) => ({
  id, appointment_type: 'maintenance', scheduled_date: date, intervention_id: interventionId,
  technician_ids: techs, status: 'scheduled', ...extra,
});
const arrondi = (n) => Math.round(n * 100) / 100;

test('cleAffaire : installation → chantier, entretien → intervention, le reste ne compte pas', () => {
  assert.equal(cleAffaire(pose('a', '2026-11-16', 'c1', [])), 'chantier:c1');
  assert.equal(cleAffaire(entretien('a', '2026-11-16', 'i1', [])), 'entretien:i1');
  // SAV : compté 0 pour l'instant (Eric, 2026-11-14), même rattaché à une intervention.
  assert.equal(cleAffaire({ appointment_type: 'service', intervention_id: 'i1' }), null);
  assert.equal(cleAffaire({ appointment_type: 'rdv_technical', lead_id: 'l1' }), null);
  assert.equal(cleAffaire({ appointment_type: 'leave' }), null);
  assert.equal(cleAffaire({ appointment_type: 'installation' }), null);
});

test('tauxTvaContrat : taux unique, moyenne des taux mixtes, 20 % quand on ne sait pas', () => {
  assert.equal(tauxTvaContrat([5.5]), 5.5);
  assert.equal(tauxTvaContrat([5.5, 5.5]), 5.5);
  assert.equal(tauxTvaContrat([5.5, 10]), 7.75);
  assert.equal(tauxTvaContrat([]), 20);
  assert.equal(tauxTvaContrat([null]), 20);
  assert.equal(tauxTvaContrat([null, 5.5]), 12.75);
  assert.equal(tauxTvaContrat(['5.50']), 5.5);
});

test('montantHtContrat : le montant du contrat est TTC', () => {
  assert.equal(arrondi(montantHtContrat(211, [5.5])), 200);
  assert.equal(arrondi(montantHtContrat('220.00', [10])), 200);
  assert.equal(montantHtContrat(null, [5.5]), 0);
});

test('chantier sur plusieurs jours : prorata des journées, y compris hors de la plage affichée', () => {
  const affiches = [pose('a1', '2026-11-16', 'c1', ['t1', 't2']), pose('a2', '2026-11-17', 'c1', ['t1', 't2'])];
  // Le 3ᵉ jour du chantier est la semaine suivante : il n'est pas affiché mais il compte.
  const complets = [...affiches, pose('a3', '2026-11-23', 'c1', ['t1'])];
  const { parJour, parTechnicienJour } = caProgramme({
    rdvs: affiches,
    joursParAffaire: indexerJours(complets),
    montantParAffaire: new Map([['chantier:c1', 6000]]),
  });
  assert.equal(parJour.get('2026-11-16'), 2000);
  assert.equal(parJour.get('2026-11-17'), 2000);
  assert.equal(parJour.has('2026-11-23'), false);
  assert.equal(parTechnicienJour.get('2026-11-16|t1'), 1000);
  assert.equal(parTechnicienJour.get('2026-11-16|t2'), 1000);
});

test('dynamique : déplacer ou ajouter un jour change la part de chaque journée', () => {
  const montantParAffaire = new Map([['chantier:c1', 6000]]);
  const deuxJours = [pose('a1', '2026-11-16', 'c1', ['t1']), pose('a2', '2026-11-17', 'c1', ['t1'])];
  const avant = caProgramme({ rdvs: deuxJours, joursParAffaire: indexerJours(deuxJours), montantParAffaire });
  assert.equal(avant.parJour.get('2026-11-16'), 3000);
  const troisJours = [...deuxJours, pose('a3', '2026-11-18', 'c1', ['t1'])];
  const apres = caProgramme({ rdvs: troisJours, joursParAffaire: indexerJours(troisJours), montantParAffaire });
  assert.equal(apres.parJour.get('2026-11-16'), 2000);
  assert.equal(apres.parJour.get('2026-11-18'), 2000);
});

test('un RDV annulé ne compte ni comme journée ni comme chiffre', () => {
  const rdvs = [
    pose('a1', '2026-11-16', 'c1', ['t1']),
    pose('a2', '2026-11-17', 'c1', ['t1'], { status: 'cancelled' }),
  ];
  const { parJour } = caProgramme({
    rdvs, joursParAffaire: indexerJours(rdvs), montantParAffaire: new Map([['chantier:c1', 6000]]),
  });
  assert.equal(parJour.get('2026-11-16'), 6000);
  assert.equal(parJour.has('2026-11-17'), false);
});

test('deux RDV du même chantier le même jour : une seule journée, techniciens réunis', () => {
  const rdvs = [pose('a1', '2026-11-16', 'c1', ['t1']), pose('a2', '2026-11-16', 'c1', ['t2'])];
  const { parJour, parTechnicienJour } = caProgramme({
    rdvs, joursParAffaire: indexerJours(rdvs), montantParAffaire: new Map([['chantier:c1', 4000]]),
  });
  assert.equal(parJour.get('2026-11-16'), 4000);
  assert.equal(parTechnicienJour.get('2026-11-16|t1'), 2000);
  assert.equal(parTechnicienJour.get('2026-11-16|t2'), 2000);
});

test('entretien + installation le même jour ; SAV, VT et congés à 0', () => {
  const rdvs = [
    pose('a1', '2026-11-16', 'c1', ['t1', 't2']),
    entretien('e1', '2026-11-16', 'i1', ['t3']),
    entretien('e2', '2026-11-16', 'i2', ['t3']),
    { id: 's1', appointment_type: 'service', scheduled_date: '2026-11-16', intervention_id: 'i9', technician_ids: ['t3'], status: 'scheduled' },
    { id: 'v1', appointment_type: 'rdv_technical', scheduled_date: '2026-11-16', lead_id: 'l1', technician_ids: [], status: 'scheduled' },
    { id: 'l1', appointment_type: 'leave', scheduled_date: '2026-11-16', technician_ids: ['t4'], status: 'scheduled' },
  ];
  const { parJour, parTechnicienJour } = caProgramme({
    rdvs,
    joursParAffaire: indexerJours(rdvs),
    montantParAffaire: new Map([['chantier:c1', 5000], ['entretien:i1', 200], ['entretien:i2', 150], ['entretien:i9', 999]]),
  });
  assert.equal(parJour.get('2026-11-16'), 5350);
  assert.equal(parTechnicienJour.get('2026-11-16|t1'), 2500);
  assert.equal(parTechnicienJour.get('2026-11-16|t3'), 350);
  assert.equal(parTechnicienJour.has('2026-11-16|t4'), false);
});

test('filtre équipe : le total du jour est la part des personnes affichées', () => {
  const rdvs = [pose('a1', '2026-11-16', 'c1', ['t1', 't2']), entretien('e1', '2026-11-16', 'i1', ['t3'])];
  const base = {
    rdvs, joursParAffaire: indexerJours(rdvs),
    montantParAffaire: new Map([['chantier:c1', 5000], ['entretien:i1', 200]]),
  };
  assert.equal(caProgramme({ ...base, technicienIds: new Set(['t1']) }).parJour.get('2026-11-16'), 2500);
  assert.equal(caProgramme({ ...base, technicienIds: new Set(['t1', 't3']) }).parJour.get('2026-11-16'), 2700);
  assert.equal(caProgramme({ ...base, technicienIds: new Set(['t9']) }).parJour.has('2026-11-16'), false);
});

test('RDV sans technicien : compté dans le jour, dans aucune part', () => {
  const rdvs = [pose('a1', '2026-11-16', 'c1', [])];
  const base = { rdvs, joursParAffaire: indexerJours(rdvs), montantParAffaire: new Map([['chantier:c1', 3000]]) };
  const tout = caProgramme(base);
  assert.equal(tout.parJour.get('2026-11-16'), 3000);
  assert.equal(tout.parTechnicienJour.size, 0);
  assert.equal(caProgramme({ ...base, technicienIds: new Set(['t1']) }).parJour.has('2026-11-16'), false);
});

test('affaire sans montant : comptée à 0 et signalée', () => {
  const rdvs = [pose('a1', '2026-11-16', 'c1', ['t1']), entretien('e1', '2026-11-16', 'i1', ['t1'])];
  const { parJour, sansMontantParJour } = caProgramme({
    rdvs, joursParAffaire: indexerJours(rdvs), montantParAffaire: new Map([['chantier:c1', 3000]]),
  });
  assert.equal(parJour.get('2026-11-16'), 3000);
  assert.equal(sansMontantParJour.get('2026-11-16'), 1);
});

test('liste des jours absente : les jours affichés font foi (jamais de division par zéro)', () => {
  const rdvs = [pose('a1', '2026-11-16', 'c1', ['t1'])];
  const { parJour } = caProgramme({ rdvs, joursParAffaire: new Map(), montantParAffaire: new Map([['chantier:c1', 3000]]) });
  assert.equal(parJour.get('2026-11-16'), 3000);
});

test('formatCa : euros entiers, espaces ordinaires', () => {
  assert.equal(formatCa(2150.4), '2 150 €');
  assert.equal(formatCa(790), '790 €');
  assert.equal(formatCa(0), '0 €');
});
