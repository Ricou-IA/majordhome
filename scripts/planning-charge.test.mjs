import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chargeDuJour, joursDeLaPlage, lignesDeCharge, panneauDeLigne, sortJourneeDemandee,
} from '../src/lib/planningCharge.js';

const SEMAINE = { monday: { active: true, start: '08:00', end: '17:00' }, tuesday: { active: true, start: '08:00', end: '17:00' },
  wednesday: { active: true, start: '08:00', end: '17:00' }, thursday: { active: true, start: '08:00', end: '17:00' },
  friday: { active: true, start: '08:00', end: '16:00' }, saturday: { active: false }, sunday: { active: false } };
// Équipe inspirée de Mayer : Antoine planifié par le moteur, Mohammed hors tournées, Eric admin.
const ANTOINE = { id: 'ant', role: 'technician', include_in_routing: true, display_name: 'Antoine Verloo', calendar_color: '#f97316', default_availability: SEMAINE };
const MOHAMMED = { id: 'moh', role: 'technician', include_in_routing: false, display_name: 'Mohammed ', calendar_color: '#22c55e', default_availability: SEMAINE };
const ERIC = { id: 'eri', role: 'admin', include_in_routing: false, display_name: 'Eric Pudebat', calendar_color: '#3b82f6', default_availability: SEMAINE };
const MEMBRES = [ANTOINE, MOHAMMED, ERIC];

let n = 0;
const rdv = (date, type, techs, extra = {}) => ({ id: `r${n += 1}`, scheduled_date: date, appointment_type: type, technician_ids: techs, status: 'scheduled', ...extra });
// Semaine passée (lundi 9 → dimanche 15 novembre 2026), vue depuis le lundi 16.
const base = { membres: MEMBRES, debut: '2026-11-09', finExclue: '2026-11-16', aujourdhui: '2026-11-16' };

test('chargeDuJour : seules les interventions non annulées comptent', () => {
  const r = (type, status = 'scheduled') => ({ appointment_type: type, status });
  assert.deepEqual(chargeDuJour([r('other')]), { interventions: [], enConges: false });
  assert.deepEqual(chargeDuJour([r('rdv_technical'), r('rdv_closing')]), { interventions: [], enConges: false });
  const mixte = chargeDuJour([r('other'), r('installation'), r('service'), r('maintenance'), r('installation', 'cancelled')]);
  assert.deepEqual(mixte.interventions.map((x) => x.appointment_type), ['installation', 'service', 'maintenance']);
  // En congés = aucune intervention et un congé posé (non annulé).
  assert.equal(chargeDuJour([r('leave')]).enConges, true);
  assert.equal(chargeDuJour([r('leave'), r('other')]).enConges, true);
  assert.equal(chargeDuJour([r('leave'), r('service')]).enConges, false);
  assert.equal(chargeDuJour([r('leave', 'cancelled')]).enConges, false);
  assert.deepEqual(chargeDuJour(null), { interventions: [], enConges: false });
});

test('joursDeLaPlage : borne de fin exclue, changement de mois', () => {
  assert.deepEqual(joursDeLaPlage('2026-11-09', '2026-11-12'), ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.deepEqual(joursDeLaPlage('2026-11-30', '2026-12-02'), ['2026-11-30', '2026-12-01']);
  assert.deepEqual(joursDeLaPlage(null, '2026-12-02'), []);
  assert.deepEqual(joursDeLaPlage('nope', '2026-12-02'), []);
});

test('lignesDeCharge : jour férié, tout le monde en congés = aucune ligne', () => {
  const lignes = lignesDeCharge({
    ...base,
    rdvs: [rdv('2026-11-11', 'leave', ['ant']), rdv('2026-11-11', 'leave', ['moh']), rdv('2026-11-11', 'leave', ['eri'])],
  });
  assert.deepEqual([...lignes.keys()].filter((k) => k.startsWith('2026-11-11')), []);
});

test('lignesDeCharge : technicien libre un jour travaillé = ligne Vide, pas le week-end', () => {
  const lignes = lignesDeCharge({ ...base, rdvs: [] });
  const lundi = lignes.get('2026-11-09|moh');
  assert.equal(lundi.etat, 'vide');
  assert.equal(lundi.sansIntervention, true);
  assert.equal(lundi.horsMoteur, true);
  assert.equal(lundi.technicienNom, 'Mohammed');
  // Jour passé d'un technicien que le moteur planifie : même ligne.
  assert.equal(lignes.get('2026-11-09|ant').etat, 'vide');
  // Samedi et dimanche non travaillés ; l'admin n'est pas un technicien.
  assert.equal(lignes.has('2026-11-14|ant'), false);
  assert.equal(lignes.has('2026-11-15|moh'), false);
  assert.equal([...lignes.keys()].some((k) => k.endsWith('|eri')), false);
  assert.equal(lignes.size, 10);
});

test('lignesDeCharge : RDV « Autre » ou commercial = pas de ligne pour un non-technicien, Vide pour un technicien', () => {
  const lignes = lignesDeCharge({
    ...base,
    rdvs: [rdv('2026-11-12', 'other', ['eri']), rdv('2026-11-12', 'rdv_technical', ['moh'])],
  });
  assert.equal(lignes.has('2026-11-12|eri'), false);
  assert.equal(lignes.get('2026-11-12|moh').etat, 'vide');
});

test('lignesDeCharge : interventions = ligne avec zone ; non-technicien posé sur un chantier', () => {
  const pose = rdv('2026-11-10', 'installation', ['moh', 'eri'], { city: 'Coufouleux', scheduled_start: '08:00:00' });
  const entretien = rdv('2026-11-10', 'maintenance', ['ant'], { grand_secteur: 'Gaillac', city: 'Brens', created_at: '2026-10-01' });
  const lignes = lignesDeCharge({ ...base, rdvs: [pose, entretien] });
  const moh = lignes.get('2026-11-10|moh');
  assert.equal(moh.etat, 'manuelle');
  assert.equal(moh.lieu, 'Coufouleux');
  assert.equal(moh.sansIntervention, false);
  assert.equal(moh.nbRdvs, 1);
  assert.equal(lignes.get('2026-11-10|eri').etat, 'sans_etat');
  const ant = lignes.get('2026-11-10|ant');
  assert.equal(ant.etat, 'sans_etat');
  assert.equal(ant.etiquette, 'Gaillac');
});

test('lignesDeCharge : jours à venir = verdict du moteur, congés masqués', () => {
  const futur = { ...base, debut: '2026-11-16', finExclue: '2026-11-18' };
  const etatsMoteur = new Map([
    ['2026-11-16|ant', { date: '2026-11-16', technicienId: 'ant', technicienNom: 'Antoine Verloo', etat: 'vide', etiquette: null, enConges: false }],
    ['2026-11-17|ant', { date: '2026-11-17', technicienId: 'ant', technicienNom: 'Antoine Verloo', etat: 'pleine', etiquette: null, enConges: true }],
  ]);
  const lignes = lignesDeCharge({
    ...futur, etatsMoteur,
    rdvs: [rdv('2026-11-17', 'leave', ['ant']), rdv('2026-11-16', 'installation', ['moh'], { city: 'Albi' })],
  });
  assert.equal(lignes.get('2026-11-16|ant').etat, 'vide');
  assert.equal(lignes.get('2026-11-16|ant').sansIntervention, true);
  assert.equal(lignes.get('2026-11-16|ant').horsMoteur, undefined);
  // Congé : le moteur voit la journée « pleine », la ligne disparaît.
  assert.equal(lignes.has('2026-11-17|ant'), false);
  // Hors tournées : ses jours à venir aussi (Vide le 17).
  assert.equal(lignes.get('2026-11-16|moh').etat, 'manuelle');
  assert.equal(lignes.get('2026-11-17|moh').etat, 'vide');
});

test('lignesDeCharge : moteur en chargement, pas de ligne provisoire pour ses techniciens', () => {
  const futur = { ...base, debut: '2026-11-16', finExclue: '2026-11-17', moteurEnChargement: true };
  const lignes = lignesDeCharge({ ...futur, rdvs: [rdv('2026-11-16', 'maintenance', ['ant'])] });
  assert.equal(lignes.has('2026-11-16|ant'), false);
  // Le moteur ne juge jamais le technicien hors tournées : sa ligne n'attend pas.
  assert.equal(lignes.get('2026-11-16|moh').etat, 'vide');
});

test('lignesDeCharge : RDV partiels (filtre de type), on ne dit pas qu’une journée est vide', () => {
  const etatsMoteur = new Map([
    ['2026-11-16|ant', { date: '2026-11-16', technicienId: 'ant', technicienNom: 'Antoine Verloo', etat: 'pleine', etiquette: 'Gaillac', enConges: false }],
  ]);
  const lignes = lignesDeCharge({
    ...base, debut: '2026-11-13', finExclue: '2026-11-17', etatsMoteur, rdvsPartiels: true,
    rdvs: [rdv('2026-11-13', 'installation', ['moh'], { city: 'Albi' })],
  });
  // Pas de ligne « Vide » déduite, pas de « 0 € » sur la journée que le moteur dit pleine.
  assert.equal(lignes.has('2026-11-13|ant'), false);
  assert.equal(lignes.has('2026-11-16|moh'), false);
  assert.equal(lignes.get('2026-11-16|ant').sansIntervention, false);
  assert.equal(lignes.get('2026-11-13|moh').etat, 'manuelle');
});

test('lignesDeCharge : filtre équipe', () => {
  const lignes = lignesDeCharge({ ...base, filtreIds: new Set(['moh']), rdvs: [rdv('2026-11-10', 'maintenance', ['ant'])] });
  assert.equal([...lignes.keys()].every((k) => k.endsWith('|moh')), true);
  assert.equal(lignes.size, 5);
});

test('panneauDeLigne : feuille de route pour une journée sans verdict du moteur', () => {
  assert.equal(panneauDeLigne({ etat: 'manuelle' }), 'feuille');
  assert.equal(panneauDeLigne({ etat: 'sans_etat' }), 'feuille');
  for (const etat of ['vide', 'ouverte', 'pleine', 'figee', 'a_arbitrer']) assert.equal(panneauDeLigne({ etat }), 'journee', etat);
  assert.equal(panneauDeLigne(null), 'journee');
});

test('sortJourneeDemandee : attendre, erreur, ou journée absente de l’horizon', () => {
  const demandee = { date: '2026-11-18', technicienId: 'ant' };
  const connu = { demandee, trouvee: null, horizonConnu: true, finPlage: '2026-11-23' };
  assert.equal(sortJourneeDemandee({ demandee: null, trouvee: null }), 'aucune');
  assert.equal(sortJourneeDemandee({ ...connu, trouvee: { date: '2026-11-18' } }), 'ouverte');
  // Une journée trouvée reste ouverte même si un rechargement échoue ensuite.
  assert.equal(sortJourneeDemandee({ ...connu, trouvee: {}, erreur: new Error('x') }), 'ouverte');
  assert.equal(sortJourneeDemandee({ ...connu, erreur: new Error('x') }), 'erreur');
  assert.equal(sortJourneeDemandee({ ...connu, enChargement: true }), 'attendre');
  assert.equal(sortJourneeDemandee({ ...connu, horizonConnu: false }), 'attendre');
  assert.equal(sortJourneeDemandee({ ...connu, finPlage: null }), 'attendre');
  // Lien direct vers une date que la plage affichée ne couvre pas encore.
  assert.equal(sortJourneeDemandee({ ...connu, finPlage: '2026-11-16' }), 'attendre');
  assert.equal(sortJourneeDemandee(connu), 'absente');
});
