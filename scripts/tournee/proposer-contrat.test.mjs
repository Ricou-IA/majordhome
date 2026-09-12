// scripts/tournee/proposer-contrat.test.mjs
// Question inverse de l'onglet Tournées : pour CE contrat, quelles journées ?
// Run : node --test scripts/tournee/proposer-contrat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposerPourContrat, techniciensEligibles, journeesCandidates } from '../../src/lib/tournee/proposer-contrat.js';

const DEPOT = { lat: 43.900, lng: 1.900 };            // clé "43.900,1.900"
const REGLAGES = {
  horizon_ferme_jours: 15, horizon_ouverture_jours: 45,
  pause_minutes: 30, pause_fenetre: [12, 14],
};
const AUJOURDHUI = '2026-09-14'; // lundi
// Compétences par TYPE × rôle (coché = compétent). Types : clim ∈ cat_clim, poele_g ∈ cat_poele.
const TYPES_PAR_CATEGORIE = new Map([['cat_clim', ['clim', 'gainable']], ['cat_poele', ['poele_g', 'poele_b']]]);
const ANTOINE = { id: 'antoine', nom: 'Antoine', competences: { entretien: ['clim', 'poele_g'], pose: [] } };
const LUDOVIC = { id: 'ludovic', nom: 'Ludovic', competences: { entretien: ['poele_g'], pose: [] } };
// « Poly » : tout coché (l'ancien « vide = polyvalent » n'existe plus)
const POLYVALENT = { id: 'poly', nom: 'Poly', competences: { entretien: ['clim', 'gainable', 'poele_g', 'poele_b'], pose: [] } };
const ROLE = 'entretien';

/** Journée d'un technicien : rdvs = [{id, lat, lng, duration_minutes, scheduled_start, client_name, city}] */
const journee = (date, technicienId, rdvs = []) => ({
  date, technicienId, technicienNom: technicienId, couleur: null,
  amplitude: { debut: 480, fin: 1080 }, budgetMinutes: 480,
  rdvs, chargeMinutes: rdvs.reduce((s, r) => s + r.duration_minutes, 0),
  estAmorcee: rdvs.length > 0,
});
const rdv = (id, heure, lat, lng, duree = 90) => ({
  id, lat, lng, duration_minutes: duree, scheduled_start: heure, client_name: id.toUpperCase(), city: 'GAILLAC', appointment_type: 'maintenance',
});
/** Trajet : 10 min entre points distincts, sauf paires listées. */
const trajetAvec = (special = {}) => (a, b) => (a === b ? 0 : (special[`${a}|${b}`] ?? 10));

const CONTRAT = { id: 'c1', dureeMinutes: 60, lat: 43.600, lng: 2.240, exigences: [{ typeId: 'clim' }], typesParCategorie: TYPES_PAR_CATEGORIE }; // Castres

test('compétence : seul un technicien couvrant toutes les exigences (types cochés pour le rôle) est éligible', () => {
  assert.deepEqual(techniciensEligibles(CONTRAT, [ANTOINE, LUDOVIC, POLYVALENT], ROLE).map((t) => t.id), ['antoine', 'poly']);
  const multi = { ...CONTRAT, exigences: [{ typeId: 'clim' }, { typeId: 'poele_b' }] };
  assert.deepEqual(techniciensEligibles(multi, [ANTOINE, LUDOVIC, POLYVALENT], ROLE).map((t) => t.id), ['poly']);
});

test('classement par coût : la journée où la tournée passe déjà à côté gagne, pas la plus proche dans le temps', () => {
  const journees = [
    journee('2026-09-15', 'antoine', [rdv('a', '08:00', 43.900, 1.900)]),            // au dépôt, loin de Castres
    journee('2026-09-17', 'antoine', [rdv('b', '08:00', 43.600, 2.240)]),            // même clé que le contrat → trajet 0
  ];
  const { creneaux } = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(creneaux.length, 2);
  assert.equal(creneaux[0].date, '2026-09-17');
  assert.ok(creneaux[0].coutMinutes < creneaux[1].coutMinutes);
  assert.equal(creneaux[0].technicianId, 'antoine');
  assert.equal(creneaux[0].technicianNom, 'antoine');
  assert.equal(creneaux[0].avant.id, 'b');            // inséré après B
  assert.equal(creneaux[0].avant.label, 'B');
  assert.equal(creneaux[0].avant.finMinutes, 570);    // 08:00 + 90
  assert.equal(creneaux[0].apres, null);              // puis retour dépôt
});

test('au-delà de l horizon ferme, seules les journées amorcées sont proposées ; les vides deviennent des nouvellesJournees si rien ne rentre', () => {
  const journees = [
    journee('2026-10-12', 'antoine', []),                                        // vide, hors horizon ferme
    // amorcée mais pleine : 420 min posées + 20 min de trajets = 440, il reste
    // de la place dans l'amplitude (fin 15:00) mais pas dans le budget (480)
    journee('2026-10-13', 'antoine', [rdv('x', '08:00', 43.600, 2.240, 420)]),
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(r.creneaux.length, 0);
  assert.deepEqual(r.nouvellesJournees, [{ date: '2026-10-12', technicianId: 'antoine', technicianNom: 'antoine' }]);
  assert.equal(r.raisonsRejet.horizon, 1);
  assert.ok(r.raisonsRejet.budget >= 1);
});

test('une journée vide DANS l horizon ferme est un créneau (aller-retour dépôt), pas une nouvelle journée', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-18', 'antoine', [])], techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(r.creneaux.length, 1);
  assert.equal(r.creneaux[0].coutMinutes, 80);   // 10 + 60 + 10
  assert.equal(r.creneaux[0].avant, null);
  assert.equal(r.creneaux[0].apres, null);
  assert.deepEqual(r.nouvellesJournees, []);
});

test('contrainte periode=matin : arrivée avant 12 h ; apres_midi : arrivée à partir de 12 h', () => {
  const journees = [journee('2026-09-16', 'antoine', [rdv('m', '08:00', 43.600, 2.240, 230)])]; // libre à partir de 11:50
  const matin = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, contraintes: { periode: 'matin' },
  });
  assert.equal(matin.creneaux.length, 1);
  assert.ok(matin.creneaux[0].debutMinutes < 720);
  const apresMidi = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, contraintes: { periode: 'apres_midi' },
  });
  assert.equal(apresMidi.creneaux.length, 1);
  assert.ok(apresMidi.creneaux[0].debutMinutes >= 720);
});

test('contraintes technicianId / joursSemaineExclus / datesExclues / dateFrom-dateTo', () => {
  const journees = [
    journee('2026-09-16', 'antoine', []), // mercredi
    journee('2026-09-17', 'antoine', []), // jeudi
    journee('2026-09-17', 'poly', []),
  ];
  const base = {
    contrat: CONTRAT, journees, techniciens: [ANTOINE, POLYVALENT], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  };
  const sansMercredi = proposerPourContrat({ ...base, contraintes: { joursSemaineExclus: [3] } });
  assert.ok(sansMercredi.creneaux.length > 0);
  assert.ok(sansMercredi.creneaux.every((c) => c.date !== '2026-09-16'));
  assert.equal(sansMercredi.raisonsRejet.contrainte, 1);
  const seulementPoly = proposerPourContrat({ ...base, contraintes: { technicianId: 'poly' } });
  assert.equal(seulementPoly.creneaux.length, 1);
  assert.ok(seulementPoly.creneaux.every((c) => c.technicianId === 'poly'));
  const fenetre = proposerPourContrat({ ...base, contraintes: { dateFrom: '2026-09-17', dateTo: '2026-09-17' } });
  assert.equal(fenetre.creneaux.length, 2);
  assert.ok(fenetre.creneaux.every((c) => c.date === '2026-09-17'));
  assert.equal(proposerPourContrat({ ...base, contraintes: { datesExclues: ['2026-09-16', '2026-09-17'] } }).creneaux.length, 0);
});

test('maxResults borne la liste ; estime est propagé tel quel', () => {
  const journees = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21'].map((d) => journee(d, 'antoine', []));
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, maxResults: 4, estime: true,
  });
  assert.equal(r.creneaux.length, 4);
  assert.ok(r.creneaux.every((c) => c.estime === true));
});

test('un technicien non compétent est compté dans raisonsRejet.competence et jamais proposé', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-15', 'ludovic', []), journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE, LUDOVIC], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(r.raisonsRejet.competence, 1);
  assert.deepEqual(r.techniciensEligibles, ['antoine']);
  assert.ok(r.creneaux.every((c) => c.technicianId === 'antoine'));
});

test('contrat sans coordonnées → aucun créneau, motif position, jamais une exception', () => {
  const r = proposerPourContrat({
    contrat: { ...CONTRAT, lat: null, lng: null }, journees: [journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(r.creneaux.length, 0);
  assert.equal(r.raisonsRejet.position, 1);
});

test('les journées passées sont ignorées sans être comptées comme rejet', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-10', 'antoine', []), journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE,
  });
  assert.equal(r.creneaux.length, 1);
  assert.equal(r.creneaux[0].date, '2026-09-15');
});

// ============================================================================
// Revue 2026-09-12 — comportements ajoutés après relecture
// ============================================================================

test('équipement non typé : exigence par catégorie, satisfaite par n importe quel type coché de la catégorie', () => {
  const contrat = { ...CONTRAT, exigences: [{ typeId: 'clim' }, { categoryId: 'cat_poele' }] };
  assert.deepEqual(techniciensEligibles(contrat, [ANTOINE, LUDOVIC], ROLE).map((t) => t.id), ['antoine']);
  const seulPoele = { ...CONTRAT, exigences: [{ categoryId: 'cat_poele' }] };
  assert.deepEqual(techniciensEligibles(seulPoele, [ANTOINE, LUDOVIC], ROLE).map((t) => t.id), ['antoine', 'ludovic']);
});

test('rien coché pour le rôle = jamais proposé, même sans exigence', () => {
  const vide = { id: 'vide', nom: 'Vide', competences: { entretien: [], pose: [] } };
  const sansExigence = { ...CONTRAT, exigences: [] };
  assert.deepEqual(techniciensEligibles(sansExigence, [ANTOINE, vide], ROLE).map((t) => t.id), ['antoine']);
  assert.throws(() => techniciensEligibles(sansExigence, [ANTOINE]), /role_competence_requis/);
});

test('nouvellesJournees respecte les contraintes explicites (pas le mercredi → pas d ouverture un mercredi)', () => {
  const journees = [
    journee('2026-10-14', 'antoine', []), // mercredi, vide, hors horizon
    journee('2026-10-15', 'antoine', []), // jeudi
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, contraintes: { joursSemaineExclus: [3] },
  });
  assert.equal(r.creneaux.length, 0);
  assert.deepEqual(r.nouvellesJournees.map((j) => j.date), ['2026-10-15']);
});

test('le jour même, aucune arrivée avant maintenant + marge', () => {
  const journees = [journee(AUJOURDHUI, 'antoine', [])];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, maintenantMinutes: 16 * 60, margeAujourdhuiMinutes: 60,
  });
  // 17:00 + 60 min d'intervention + 10 min de retour = 18:10 > 18:00 → rien aujourd'hui
  assert.equal(r.creneaux.length, 0);
  const tot = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, role: ROLE, maintenantMinutes: 9 * 60,
  });
  assert.equal(tot.creneaux.length, 1);
  assert.ok(tot.creneaux[0].debutMinutes >= 10 * 60);
});

test('journeesCandidates : seulement technicien éligible + horizon + contraintes (pour borner la matrice)', () => {
  const journees = [
    journee('2026-09-15', 'antoine', []),
    journee('2026-09-15', 'ludovic', []),          // pas la compétence
    journee('2026-10-12', 'antoine', []),          // vide hors horizon
    journee('2026-10-13', 'antoine', [rdv('x', '08:00', 43.6, 2.24)]), // amorcée hors horizon → oui
  ];
  const c = journeesCandidates({ contrat: CONTRAT, journees, techniciens: [ANTOINE, LUDOVIC], reglages: REGLAGES, aujourdhui: AUJOURDHUI, role: ROLE });
  assert.deepEqual(c.map((j) => `${j.date}/${j.technicienId}`), ['2026-09-15/antoine', '2026-10-13/antoine']);
});
