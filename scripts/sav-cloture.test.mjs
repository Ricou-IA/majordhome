import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUTS_CLOTURE_DIRECTE, dateLocale, minutesDe, heureDe, peutCloturerSansPlanifier,
  clotureParDefaut, validerCloture, construireRdvCloture, peutIdentifierPieces, peutRangerSurDemandeSav,
} from '../src/lib/savCloture.js';

const carte = (extra = {}) => ({
  id: 'int-1', intervention_type: 'sav', workflow_status: 'demande', client_id: 'cli-1',
  client_name: 'GRAHOVAC SYLVIE', client_last_name: 'GRAHOVAC', client_first_name: 'SYLVIE',
  client_phone: '0611719929', client_email: 'a@b.fr', client_address: '1497F CHEMIN DE L’EVEQUE',
  client_city: 'MONTBETON', client_postal_code: '82290', sav_description: 'problème chaudière', ...extra,
});
const saisie = (extra = {}) => ({ date: '2026-11-09', startTime: '10:15', durationMinutes: 30, technicianIds: ['tm-1'], workPerformed: '', ...extra });

test('dateLocale : date du fuseau local, pas UTC', () => {
  assert.equal(dateLocale(new Date(2026, 10, 9, 23, 45)), '2026-11-09');
  assert.equal(dateLocale(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('minutesDe / heureDe', () => {
  assert.equal(minutesDe('10:15'), 615);
  assert.equal(minutesDe('00:00'), 0);
  assert.equal(minutesDe('24:00'), null);
  assert.equal(minutesDe(''), null);
  assert.equal(minutesDe('abc'), null);
  assert.equal(heureDe(615), '10:15');
  assert.equal(heureDe(0), '00:00');
});

test('peutCloturerSansPlanifier : SAV pas encore au planning', () => {
  for (const s of STATUTS_CLOTURE_DIRECTE) assert.equal(peutCloturerSansPlanifier(carte({ workflow_status: s })), true, s);
  for (const s of ['planifie', 'realise', 'facture']) assert.equal(peutCloturerSansPlanifier(carte({ workflow_status: s })), false, s);
  assert.equal(peutCloturerSansPlanifier({ intervention_type: 'entretien', workflow_status: 'a_planifier' }), false);
  assert.equal(peutCloturerSansPlanifier(null), false);
});

test('clotureParDefaut : aujourd’hui, 30 min qui viennent de finir, au quart d’heure', () => {
  const d = clotureParDefaut(new Date(2026, 10, 9, 11, 52));
  assert.deepEqual(d, { date: '2026-11-09', startTime: '11:15', durationMinutes: 30, technicianIds: [], workPerformed: '' });
  assert.equal(clotureParDefaut(new Date(2026, 10, 9, 0, 10)).startTime, '00:00');
});

test('validerCloture : saisie complète acceptée', () => {
  assert.deepEqual(validerCloture(saisie(), { aujourdhui: '2026-11-09' }), []);
  assert.deepEqual(validerCloture(saisie({ date: '2026-11-03' }), { aujourdhui: '2026-11-09' }), []);
});

test('validerCloture : refus en clair', () => {
  const ctx = { aujourdhui: '2026-11-09' };
  assert.match(validerCloture(saisie({ date: '2026-11-10' }), ctx)[0], /futur/);
  assert.match(validerCloture(saisie({ date: '' }), ctx)[0], /date/);
  assert.match(validerCloture(saisie({ startTime: '' }), ctx)[0], /heure/);
  assert.match(validerCloture(saisie({ durationMinutes: 0 }), ctx)[0], /durée/);
  assert.match(validerCloture(saisie({ startTime: '23:30', durationMinutes: 60 }), ctx)[0], /lendemain/);
  assert.match(validerCloture(saisie({ technicianIds: [] }), ctx)[0], /qui est intervenu/);
  assert.equal(validerCloture(null, ctx).length, 4);
});

test('construireRdvCloture : RDV « service » terminé, lié à la carte', () => {
  const rdv = construireRdvCloture(carte(), saisie({ workPerformed: '  Remplacement de la bougie  ' }));
  assert.equal(rdv.appointment_type, 'service');
  assert.equal(rdv.status, 'completed');
  assert.equal(rdv.intervention_id, 'int-1');
  assert.equal(rdv.client_id, 'cli-1');
  assert.equal(rdv.scheduled_date, '2026-11-09');
  assert.equal(rdv.scheduled_start, '10:15');
  assert.equal(rdv.scheduled_end, '10:45');
  assert.equal(rdv.duration_minutes, 30);
  assert.equal(rdv.subject, 'SAV');
  assert.equal(rdv.client_name, 'GRAHOVAC');
  assert.equal(rdv.description, 'problème chaudière');
  assert.match(rdv.internal_notes, /après coup/);
  assert.match(rdv.internal_notes, /Remplacement de la bougie$/);
});

test('construireRdvCloture : entretien inclus dans l’objet, notes sans texte vide', () => {
  const rdv = construireRdvCloture(carte({ includes_entretien: true, client_last_name: null }), saisie());
  assert.equal(rdv.subject, 'SAV + Entretien');
  assert.equal(rdv.client_name, 'GRAHOVAC SYLVIE');
  assert.equal(rdv.internal_notes.split('\n').length, 1);
});

// ── Ouverture aux techniciens (2026-11-09) ──────────────────────────────────
import { colonnesTechnicien, carteVisibleParTechnicien, limiteALaCloture, STATUTS_TECHNICIEN } from '../src/lib/savCloture.js';

test('colonnesTechnicien : son planning + les demandes SAV en attente, jamais « Demande de contrat »', () => {
  const colonnes = colonnesTechnicien();
  for (const s of [...STATUTS_TECHNICIEN, 'demande', 'devis_envoye', 'pieces_commandees', 'a_planifier']) assert.ok(colonnes.includes(s), s);
  assert.equal(colonnes.includes('demande_contrat'), false);
  assert.equal(new Set(colonnes).size, colonnes.length);
});

test('carteVisibleParTechnicien : SAV en attente oui, entretien à planifier non', () => {
  assert.equal(carteVisibleParTechnicien(carte({ workflow_status: 'demande' })), true);
  assert.equal(carteVisibleParTechnicien(carte({ workflow_status: 'a_planifier' })), true);
  assert.equal(carteVisibleParTechnicien(carte({ workflow_status: 'planifie' })), true);
  assert.equal(carteVisibleParTechnicien({ intervention_type: 'entretien', workflow_status: 'planifie' }), true);
  assert.equal(carteVisibleParTechnicien({ intervention_type: 'entretien', workflow_status: 'realise' }), true);
  assert.equal(carteVisibleParTechnicien({ intervention_type: 'entretien', workflow_status: 'a_planifier' }), false);
  assert.equal(carteVisibleParTechnicien({ intervention_type: 'entretien', workflow_status: 'demande_contrat' }), false);
  assert.equal(carteVisibleParTechnicien(null), false);
});

test('limiteALaCloture : le technicien seulement, et seulement sur une demande en attente', () => {
  assert.equal(limiteALaCloture(carte({ workflow_status: 'demande' }), 'technicien'), true);
  assert.equal(limiteALaCloture(carte({ workflow_status: 'pieces_commandees' }), 'technicien'), true);
  assert.equal(limiteALaCloture(carte({ workflow_status: 'planifie' }), 'technicien'), false);
  assert.equal(limiteALaCloture(carte({ workflow_status: 'demande' }), 'team_leader'), false);
  assert.equal(limiteALaCloture(carte({ workflow_status: 'demande' }), 'org_admin'), false);
  assert.equal(limiteALaCloture(carte({ workflow_status: 'demande' }), null), false);
});

// ── Gardes d'écran : pièces identifiées et rangement (2026-11-12) ──────────
test('peutIdentifierPieces : technicien sur demande, planifiée ; jamais sur Réalisé', () => {
  assert.equal(peutIdentifierPieces(carte(), { role: 'technicien', canEditSAV: false }), true);
  assert.equal(peutIdentifierPieces(carte({ workflow_status: 'planifie' }), { role: 'technicien', canEditSAV: false }), true);
  assert.equal(peutIdentifierPieces(carte({ workflow_status: 'realise' }), { role: 'org_admin', canEditSAV: true }), false);
  assert.equal(peutIdentifierPieces(carte(), { role: 'commercial', canEditSAV: false }), false);
  assert.equal(peutIdentifierPieces(carte({ intervention_type: 'entretien' }), { role: 'technicien', canEditSAV: true }), false);
});
test('peutRangerSurDemandeSav : clients.edit suffit', () => {
  assert.equal(peutRangerSurDemandeSav({ canEditClient: true }), true);
  assert.equal(peutRangerSurDemandeSav({ canEditClient: false }), false);
});
