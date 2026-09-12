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
const ANTOINE = { id: 'antoine', nom: 'Antoine', specialties: ['climatisation', 'poele'] };
const LUDOVIC = { id: 'ludovic', nom: 'Ludovic', specialties: ['poele'] };
const POLYVALENT = { id: 'poly', nom: 'Poly', specialties: [] };

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

const CONTRAT = { id: 'c1', dureeMinutes: 60, lat: 43.600, lng: 2.240, categories: ['climatisation'] }; // Castres

test('compétence : seul un technicien couvrant toutes les catégories est éligible ; vide = polyvalent', () => {
  assert.deepEqual(techniciensEligibles(CONTRAT, [ANTOINE, LUDOVIC, POLYVALENT]).map((t) => t.id), ['antoine', 'poly']);
  const multi = { ...CONTRAT, categories: ['climatisation', 'chaudiere_gaz'] };
  assert.deepEqual(techniciensEligibles(multi, [ANTOINE, LUDOVIC, POLYVALENT]).map((t) => t.id), ['poly']);
});

test('classement par coût : la journée où la tournée passe déjà à côté gagne, pas la plus proche dans le temps', () => {
  const journees = [
    journee('2026-09-15', 'antoine', [rdv('a', '08:00', 43.900, 1.900)]),            // au dépôt, loin de Castres
    journee('2026-09-17', 'antoine', [rdv('b', '08:00', 43.600, 2.240)]),            // même clé que le contrat → trajet 0
  ];
  const { creneaux } = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(creneaux.length, 2);
  // Présentation chronologique (15 puis 17), mais le 17 est le mieux classé.
  assert.deepEqual(creneaux.map((k) => k.date), ['2026-09-15', '2026-09-17']);
  const [j15, j17] = creneaux;
  assert.ok(j17.scoreMinutes < j15.scoreMinutes);
  assert.ok(j17.coutMinutes < j15.coutMinutes);
  assert.equal(j17.technicianId, 'antoine');
  assert.equal(j17.technicianNom, 'antoine');
  assert.equal(j17.avant.id, 'b');            // inséré après B
  assert.equal(j17.avant.label, 'B');
  assert.equal(j17.avant.finMinutes, 570);    // 08:00 + 90
  assert.equal(j17.apres, null);              // puis retour dépôt
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
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 0);
  assert.deepEqual(r.nouvellesJournees, [{ date: '2026-10-12', technicianId: 'antoine', technicianNom: 'antoine' }]);
  assert.equal(r.raisonsRejet.horizon, 1);
  assert.ok(r.raisonsRejet.budget >= 1);
});

test('une journée vide DANS l horizon ferme est un créneau (aller-retour dépôt), pas une nouvelle journée', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-18', 'antoine', [])], techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
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
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, contraintes: { periode: 'matin' },
  });
  assert.equal(matin.creneaux.length, 1);
  assert.ok(matin.creneaux[0].debutMinutes < 720);
  const apresMidi = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, contraintes: { periode: 'apres_midi' },
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
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
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
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, maxResults: 4, estime: true,
  });
  assert.equal(r.creneaux.length, 4);
  assert.ok(r.creneaux.every((c) => c.estime === true));
  const dates = r.creneaux.map((c) => c.date);
  assert.deepEqual(dates, [...dates].sort(), 'présentés en ordre chronologique');
});

test('un technicien non compétent est compté dans raisonsRejet.competence et jamais proposé', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-15', 'ludovic', []), journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE, LUDOVIC], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.raisonsRejet.competence, 1);
  assert.deepEqual(r.techniciensEligibles, ['antoine']);
  assert.ok(r.creneaux.every((c) => c.technicianId === 'antoine'));
});

test('contrat sans coordonnées → aucun créneau, motif position, jamais une exception', () => {
  const r = proposerPourContrat({
    contrat: { ...CONTRAT, lat: null, lng: null }, journees: [journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 0);
  assert.equal(r.raisonsRejet.position, 1);
});

test('les journées passées sont ignorées sans être comptées comme rejet', () => {
  const r = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-10', 'antoine', []), journee('2026-09-15', 'antoine', [])],
    techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 1);
  assert.equal(r.creneaux[0].date, '2026-09-15');
});

// ============================================================================
// Revue 2026-09-12 — comportements ajoutés après relecture
// ============================================================================

test('« autre » n est pas une compétence : un technicien spécialisé reste éligible', () => {
  const contrat = { ...CONTRAT, categories: ['climatisation', 'autre'] };
  assert.deepEqual(techniciensEligibles(contrat, [ANTOINE, LUDOVIC]).map((t) => t.id), ['antoine']);
});

test('nouvellesJournees respecte les contraintes explicites (pas le mercredi → pas d ouverture un mercredi)', () => {
  const journees = [
    journee('2026-10-14', 'antoine', []), // mercredi, vide, hors horizon
    journee('2026-10-15', 'antoine', []), // jeudi
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, contraintes: { joursSemaineExclus: [3] },
  });
  assert.equal(r.creneaux.length, 0);
  assert.deepEqual(r.nouvellesJournees.map((j) => j.date), ['2026-10-15']);
});

test('le jour même, aucune arrivée avant maintenant + marge', () => {
  const journees = [journee(AUJOURDHUI, 'antoine', [])];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, maintenantMinutes: 16 * 60, margeAujourdhuiMinutes: 60,
  });
  // 17:00 + 60 min d'intervention + 10 min de retour = 18:10 > 18:00 → rien aujourd'hui
  assert.equal(r.creneaux.length, 0);
  const tot = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI, maintenantMinutes: 9 * 60,
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
  const c = journeesCandidates({ contrat: CONTRAT, journees, techniciens: [ANTOINE, LUDOVIC], reglages: REGLAGES, aujourdhui: AUJOURDHUI });
  assert.deepEqual(c.map((j) => `${j.date}/${j.technicienId}`), ['2026-09-15/antoine', '2026-10-13/antoine']);
});

test('les trois chiffres de l opérateur : trajet aller, travail, reste utile avant le suivant', () => {
  // Trajet 10 min partout ; RDV b à 14:00 (90 min). Candidat 60 min placé au plus tôt : 08:10-09:10.
  const journees = [journee('2026-09-16', 'antoine', [rdv('b', '14:00', 43.9, 1.9)])];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT, reglages: REGLAGES,
    trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  const k = r.creneaux[0];
  assert.equal(k.trajetAllerMinutes, 10);
  assert.equal(k.travailMinutes, 60);
  assert.equal(k.trajetRetourMinutes, 10);
  assert.equal(k.apres.id, 'b');
  // reste utile = 14:00 − (09:10 + 10 min de trajet) = 4 h 40
  assert.equal(k.resteUtileMinutes, 14 * 60 - (k.finMinutes + 10));
  // journée vide : reste utile jusqu'à la fin de journée, retour dépôt compris
  const vide = proposerPourContrat({
    contrat: CONTRAT, journees: [journee('2026-09-16', 'antoine', [])], techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  }).creneaux[0];
  assert.equal(vide.resteUtileMinutes, 1080 - (vide.finMinutes + 10));
});

// ============================================================================
// Souplesse (spec 2026-09-12) : décalage d'un voisin remonté, temps perdu pénalisé
// ============================================================================
const REGLAGES_SOUPLES = { ...REGLAGES, souplesse_defaut_minutes: 30, reste_utile_min_minutes: 75 };
const rdvSouple = (id, heure, lat, lng, duree, flex) => ({ ...rdv(id, heure, lat, lng, duree), time_flex_minutes: flex });

test('un voisin adaptable glisse pour faire rentrer le contrat, et le créneau porte le décalage (label, heures)', () => {
  // a 08:00-09:00 figé (heure confirmée), b 10:50 ±30, trois lieux distincts (trajets 10).
  // Contrat 100 min : trou utile = 110 − 20 = 90 → manque 10. Coût 110 = même coût qu'après b,
  // mais plus tôt → la place entre a et b (avec décalage de b) gagne.
  const journees = [journee('2026-09-16', 'antoine', [
    { ...rdv('a', '08:00', 43.7, 2.1, 60), hour_confirmed_at: '2026-09-12T08:00:00Z' },
    rdvSouple('b', '10:50', 43.8, 2.0, 60, 30),
  ])];
  const r = proposerPourContrat({
    contrat: { ...CONTRAT, dureeMinutes: 100 }, journees, techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES_SOUPLES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  const entre = r.creneaux.find((k) => k.avant?.id === 'a');
  assert.ok(entre, 'le créneau entre a et b existe grâce au décalage');
  assert.equal(entre.decalages.length, 1);
  assert.equal(entre.decalages[0].id, 'b');
  assert.equal(entre.decalages[0].label, 'B');
  assert.equal(entre.decalages[0].debutMinutesApres, 660);
  assert.equal(entre.resteUtileMinutes, 0);      // enchaîné sur b décalé
});

test('un RDV figé ne bouge jamais : sans souplesse chez le voisin, pas de décalage possible', () => {
  const journees = [journee('2026-09-16', 'antoine', [
    { ...rdv('a', '08:00', 43.7, 2.1, 60), hour_confirmed_at: '2026-09-12T08:00:00Z' },
    { ...rdv('b', '10:50', 43.8, 2.0, 60), time_flex_minutes: 0 },
  ])];
  const r = proposerPourContrat({
    contrat: { ...CONTRAT, dureeMinutes: 100 }, journees, techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES_SOUPLES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  assert.ok(r.creneaux.every((k) => k.decalages.length === 0));
  assert.ok(!r.creneaux.some((k) => k.avant?.id === 'a' && k.apres?.id === 'b'));
});

test('temps perdu pénalisé : à coût proche, la place qui laisse 50 min inutilisables passe derrière celle qui enchaîne', () => {
  // Trajets 10 partout. Jour 1 : b à 10:00 (figé) → candidat 08:10-09:10, reste 10:00 − 09:20 = 40 min perdues.
  // Jour 2 : b à 09:20 (figé) → candidat 08:10-09:10 + 10 de trajet → enchaîné (reste 0).
  const journees = [
    journee('2026-09-16', 'antoine', [{ ...rdv('b1', '10:00', 43.7, 2.1, 60), time_flex_minutes: 0 }]),
    journee('2026-09-17', 'antoine', [{ ...rdv('b2', '09:20', 43.7, 2.1, 60), time_flex_minutes: 0 }]),
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT,
    reglages: REGLAGES_SOUPLES, trajet: trajetAvec(), aujourdhui: AUJOURDHUI,
  });
  const j16 = r.creneaux.find((k) => k.date === '2026-09-16');
  const j17 = r.creneaux.find((k) => k.date === '2026-09-17');
  assert.equal(j17.resteUtileMinutes, 0);
  assert.equal(j16.resteUtileMinutes, 40);
  assert.ok(j16.scoreMinutes > j16.coutMinutes);
  assert.ok(j17.scoreMinutes < j16.scoreMinutes, 'l enchaînement est mieux classé que le temps perdu');
});

test('trajet max entre clients : rien de raisonnable → nouvellesJournees, motif trajet compté', () => {
  // Client isolé : 80 min de tout le monde, 60 min du dépôt. Journées amorcées seulement (hors horizon ferme : pas de vide proposable comme créneau).
  const loin = (a, b) => (a === b ? 0 : (a === '43.900,1.900' || b === '43.900,1.900' ? 60 : 80));
  const journees = [
    journee('2026-10-13', 'antoine', [rdv('x', '08:00', 43.7, 2.1, 60)]),
    journee('2026-10-14', 'antoine', []),
  ];
  const r = proposerPourContrat({
    contrat: CONTRAT, journees, techniciens: [ANTOINE], depot: DEPOT,
    reglages: { ...REGLAGES, trajet_max_entre_clients_minutes: 45, souplesse_defaut_minutes: 30 },
    trajet: loin, aujourdhui: AUJOURDHUI,
  });
  assert.equal(r.creneaux.length, 0);
  assert.equal(r.raisonsRejet.trajet, 1);
  assert.deepEqual(r.nouvellesJournees.map((j) => j.date), ['2026-10-14']);
});
