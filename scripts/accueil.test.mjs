import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plageAccueil, journeeAffichee, compterRdv, personnesDuRdv, lieuDuRdv, lignesATraiter } from '../src/lib/accueil.js';

const rdv = (date, heure, extra = {}) => ({ scheduled_date: date, scheduled_start: heure, status: 'scheduled', appointment_type: 'maintenance', ...extra });

test('plageAccueil : en semaine, du lundi en cours à deux semaines plus tard', () => {
  const p = plageAccueil(new Date(2026, 10, 18, 0, 30)); // mercredi 18 novembre, juste après minuit
  assert.equal(p.aujourdhui, '2026-11-18');
  assert.equal(p.startDate, '2026-11-16');
  assert.equal(p.endDate, '2026-11-29');
  assert.deepEqual(p.semaine, { debut: '2026-11-16', finExclue: '2026-11-23' });
  assert.equal(plageAccueil(new Date(2026, 10, 16, 8)).startDate, '2026-11-16'); // un lundi
  assert.equal(plageAccueil(new Date(2026, 10, 20, 8)).semaine.debut, '2026-11-16'); // un vendredi
});

test('plageAccueil : le week-end, la semaine de référence est la suivante et la lecture part d’aujourd’hui', () => {
  const samedi = plageAccueil(new Date(2026, 10, 21, 9));
  assert.equal(samedi.startDate, '2026-11-21');
  assert.deepEqual(samedi.semaine, { debut: '2026-11-23', finExclue: '2026-11-30' });
  assert.equal(samedi.endDate, '2026-12-06');
  const dimanche = plageAccueil(new Date(2026, 10, 22, 22));
  assert.equal(dimanche.startDate, '2026-11-22');
  assert.equal(dimanche.semaine.debut, '2026-11-23');
});

test('journeeAffichee : aujourd’hui s’il y a des RDV, triés par heure, sans annulés ni congés', () => {
  const rdvs = [
    rdv('2026-11-18', '14:00:00', { id: 'b' }),
    rdv('2026-11-18', '08:30:00', { id: 'a' }),
    rdv('2026-11-18', '10:00:00', { id: 'x', status: 'cancelled' }),
    rdv('2026-11-18', '08:00:00', { id: 'c', appointment_type: 'leave' }),
    rdv('2026-11-17', '09:00:00', { id: 'hier' }),
    rdv('2026-11-19', '09:00:00', { id: 'demain' }),
  ];
  const j = journeeAffichee(rdvs, '2026-11-18');
  assert.equal(j.date, '2026-11-18');
  assert.equal(j.estAujourdhui, true);
  assert.deepEqual(j.rdvs.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(j.conges.map((r) => r.id), ['c']);
});

test('journeeAffichee : sans RDV aujourd’hui, le prochain jour qui en a ; rien du tout = aujourd’hui vide', () => {
  const rdvs = [
    rdv('2026-11-21', '09:00:00', { id: 'annule', status: 'cancelled' }),
    rdv('2026-11-21', '08:00:00', { id: 'conge', appointment_type: 'leave' }),
    rdv('2026-11-24', '09:00:00', { id: 'mardi' }),
    rdv('2026-11-23', '11:00:00', { id: 'lundi-2' }),
    rdv('2026-11-23', '08:00:00', { id: 'lundi-1' }),
  ];
  const j = journeeAffichee(rdvs, '2026-11-21');
  assert.equal(j.date, '2026-11-23');
  assert.equal(j.estAujourdhui, false);
  assert.deepEqual(j.rdvs.map((r) => r.id), ['lundi-1', 'lundi-2']);
  assert.deepEqual(j.conges, []);
  assert.deepEqual(journeeAffichee([], '2026-11-21'), { date: '2026-11-21', estAujourdhui: true, rdvs: [], conges: [] });
  assert.deepEqual(journeeAffichee(null, '2026-11-21').rdvs, []);
});

test('compterRdv : aujourd’hui et semaine de référence, hors annulés et congés', () => {
  const plage = plageAccueil(new Date(2026, 10, 18, 9));
  const rdvs = [
    rdv('2026-11-16', '09:00:00'), rdv('2026-11-18', '09:00:00'), rdv('2026-11-18', '11:00:00'),
    rdv('2026-11-18', '15:00:00', { status: 'cancelled' }), rdv('2026-11-20', '09:00:00', { appointment_type: 'leave' }),
    rdv('2026-11-23', '09:00:00'), // semaine suivante
  ];
  assert.deepEqual(compterRdv(rdvs, plage), { aujourdhui: 2, semaine: 3 });
});

test('personnesDuRdv : techniciens et commercial, une personne une seule fois', () => {
  const equipe = [
    { profileKey: 'p1', displayName: 'Philippe', color: '#111', recordIds: ['tm-1', 'com-1'] },
    { profileKey: 'p2', displayName: 'Michel', color: '#222', recordIds: ['tm-2'] },
    { profileKey: 'p3', displayName: 'Autre', color: '#333', recordIds: ['tm-3'] },
  ];
  assert.deepEqual(
    personnesDuRdv({ technician_ids: ['tm-1', 'tm-2'], assigned_commercial_id: 'com-1' }, equipe),
    [{ cle: 'p1', nom: 'Philippe', couleur: '#111' }, { cle: 'p2', nom: 'Michel', couleur: '#222' }],
  );
  assert.deepEqual(personnesDuRdv({ technician_ids: [], assigned_commercial_id: null }, equipe), []);
  assert.deepEqual(personnesDuRdv({ technician_ids: ['inconnu'] }, equipe), []);
  assert.deepEqual(personnesDuRdv({}, undefined), []);
});

test('lieuDuRdv : code postal et ville, à défaut l’adresse, vide sans lieu', () => {
  assert.equal(lieuDuRdv({ address: '12 rue des Lilas', postal_code: '81600', city: 'Gaillac' }), '81600 Gaillac');
  assert.equal(lieuDuRdv({ postal_code: null, city: ' Albi ' }), 'Albi');
  assert.equal(lieuDuRdv({ address: ' 3 chemin du Moulin ', postal_code: '', city: '' }), '3 chemin du Moulin');
  assert.equal(lieuDuRdv({}), '');
  assert.equal(lieuDuRdv(null), '');
});

test('AccueilJournee ne lit que des champs que la vue des RDV porte', () => {
  const source = readFileSync(new URL('../src/apps/artisan/components/dashboard/AccueilJournee.jsx', import.meta.url), 'utf8');
  const lus = [...source.matchAll(/\brdv\.([a-z_]+)/g)].map((m) => m[1]);
  // Colonnes de public.majordhome_appointments lues par ce bloc (relevées en base le 2026-11-22).
  const colonnes = ['id', 'scheduled_start', 'scheduled_end', 'appointment_type', 'client_name', 'client_first_name', 'subject'];
  assert.deepEqual([...new Set(lus)].filter((champ) => !colonnes.includes(champ)), []);
});

test('lignesATraiter : seules les lignes à nombre > 0, accords, retard signalé', () => {
  const lignes = lignesATraiter({
    portefeuille: { aContacter: 1, rdvAReplanifier: 2, devisEnAttente: 12, devisSansRelance: 4 },
    chantiers: { commandeAFaire: 0, aPlanifier: 3 },
    seuilRelance: 21,
  });
  assert.deepEqual(lignes.map((l) => [l.cle, l.nombre, l.texte, l.attention]), [
    ['a-contacter', 1, 'lead à contacter', false],
    ['rdv-a-replanifier', 2, 'RDV commerciaux à replanifier', false],
    ['devis-sans-relance', 4, 'devis sans relance depuis plus de 21 jours', true],
    ['a-planifier', 3, 'chantiers à planifier', false],
  ]);
  assert.ok(lignes.every((l) => l.href.startsWith('/')));
});

test('lignesATraiter : une source inconnue ne produit aucune ligne (jamais un zéro supposé)', () => {
  assert.deepEqual(lignesATraiter({ portefeuille: null, chantiers: null, seuilRelance: 21 }), []);
  const seulChantier = lignesATraiter({ portefeuille: null, chantiers: { commandeAFaire: 2, aPlanifier: 0 }, seuilRelance: 21 });
  assert.deepEqual(seulChantier.map((l) => l.texte), ['commandes à passer']);
  assert.deepEqual(lignesATraiter({ portefeuille: { aContacter: 0, rdvAReplanifier: 0, devisEnAttente: 0, devisSansRelance: 0 }, seuilRelance: 21 }), []);
});
