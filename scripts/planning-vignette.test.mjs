import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lignesDisponibles, heureCourte, creneauCourt, gabaritVignette, modeleVignette,
  HAUTEUR_CRENEAU_TELEPHONE,
} from '../src/lib/planningVignette.js';

const le = (h, m = 0) => new Date(2026, 10, 16, h, m);

test('lignesDisponibles : la place suit la durée du RDV', () => {
  assert.equal(lignesDisponibles(30), 1);
  assert.equal(lignesDisponibles(45), 2);
  assert.equal(lignesDisponibles(60), 3);
  assert.equal(lignesDisponibles(90), 4);
  assert.equal(lignesDisponibles(120), 6);
  // Jamais moins d'une ligne ; durée inconnue = une heure.
  assert.equal(lignesDisponibles(10), 1);
  assert.equal(lignesDisponibles(null), 3);
  // Téléphone : créneaux plus hauts.
  assert.equal(lignesDisponibles(30, HAUTEUR_CRENEAU_TELEPHONE), 2);
});

test('heureCourte / creneauCourt : « 8h », « 8h40–9h40 »', () => {
  assert.equal(heureCourte(le(8)), '8h');
  assert.equal(heureCourte(le(8, 40)), '8h40');
  assert.equal(heureCourte(le(14, 5)), '14h05');
  assert.equal(heureCourte(null), '');
  assert.equal(heureCourte(new Date('nope')), '');
  assert.equal(creneauCourt(le(8), le(17)), '8h–17h');
  assert.equal(creneauCourt(le(8, 40), le(9, 40)), '8h40–9h40');
  assert.equal(creneauCourt(le(8), null), '8h');
});

test('gabaritVignette : SAV de 30 min = une ligne, installation = cadre plein', () => {
  assert.deepEqual(gabaritVignette({ dureeMinutes: 30 }), { gabarit: 'ligne', lignesNom: 1 });
  assert.deepEqual(gabaritVignette({ dureeMinutes: 45 }), { gabarit: 'deux', lignesNom: 1 });
  assert.deepEqual(gabaritVignette({ dureeMinutes: 60 }), { gabarit: 'trois', lignesNom: 1 });
  assert.deepEqual(gabaritVignette({ dureeMinutes: 90 }), { gabarit: 'trois', lignesNom: 2 });
  assert.deepEqual(gabaritVignette({ dureeMinutes: 120 }), { gabarit: 'plein', lignesNom: 3 });
  assert.deepEqual(gabaritVignette({ dureeMinutes: 540 }), { gabarit: 'plein', lignesNom: 3 });
});

test('gabaritVignette : vues Mois et liste indépendantes de la durée', () => {
  assert.equal(gabaritVignette({ vue: 'dayGridMonth', dureeMinutes: 540 }).gabarit, 'ligne');
  assert.equal(gabaritVignette({ vue: 'listWeek', dureeMinutes: 30 }).gabarit, 'deux');
  assert.equal(gabaritVignette({ vue: 'listDay', dureeMinutes: 540 }).gabarit, 'deux');
});

const sav = {
  client_name: 'ARCAMBAL', client_first_name: 'Guy', grand_secteur: 'Gaillac', city: 'Brens',
  typeConfig: { label: 'SAV', shortLabel: 'SAV' },
};
const vt = {
  client_name: 'ORSINI', client_first_name: 'Justine', grand_secteur: null, city: 'Albi',
  typeConfig: { label: 'Visite Technique R1', shortLabel: 'VT R1' },
};

test('modeleVignette : une ligne = début seul, type court, nom et zone', () => {
  const m = modeleVignette({ rdv: sav, debut: le(10), fin: le(10, 30) });
  assert.equal(m.gabarit, 'ligne');
  assert.equal(m.heure, '10h');
  assert.equal(m.type, 'SAV');
  assert.equal(m.nom, 'ARCAMBAL Guy');
  assert.equal(m.zone, 'Gaillac');
  assert.equal(m.infobulle, '10h–10h30 · SAV · ARCAMBAL Guy · Gaillac');
});

test('modeleVignette : visite d’une heure = créneau, type court, ville à défaut de secteur', () => {
  const m = modeleVignette({ rdv: vt, debut: le(11), fin: le(12) });
  assert.equal(m.gabarit, 'trois');
  assert.equal(m.heure, '11h–12h');
  assert.equal(m.type, 'VT R1');
  assert.equal(m.zone, 'Albi');
});

test('modeleVignette : cadre plein = type en toutes lettres', () => {
  const pose = { client_name: 'MOROY', client_first_name: 'Richard', grand_secteur: 'Salvagnac', typeConfig: { label: 'Installation', shortLabel: 'Install.' } };
  const m = modeleVignette({ rdv: pose, debut: le(8), fin: le(17) });
  assert.equal(m.gabarit, 'plein');
  assert.equal(m.type, 'Installation');
  assert.equal(m.heure, '8h–17h');
});

test('modeleVignette : liste sans heure, RDV sans client = son objet', () => {
  const liste = modeleVignette({ rdv: sav, debut: le(10), fin: le(10, 30), vue: 'listDay' });
  assert.equal(liste.heure, '');
  const reunion = modeleVignette({
    rdv: { subject: 'Réunion fournisseur', typeConfig: { label: 'Autre' } }, debut: le(9), fin: le(10),
  });
  assert.equal(reunion.nom, 'Réunion fournisseur');
  assert.equal(reunion.type, 'Autre');
  // Objet identique au type : pas de doublon.
  const conges = modeleVignette({ rdv: { subject: 'Congés', typeConfig: { label: 'Congés' } }, debut: le(8), fin: le(17) });
  assert.equal(conges.nom, '');
  // Fin inconnue : une heure par défaut, pas de plantage.
  assert.equal(modeleVignette({ rdv: sav, debut: le(10), fin: null }).gabarit, 'trois');
});
