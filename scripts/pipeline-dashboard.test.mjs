// Tests du module pur src/lib/pipelineDashboard.js — `node --test scripts/pipeline-dashboard.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPipelineDashboard, mesurer, indexerLeads, devisDepuisLeads, debutDesDonnees,
  jourDe, moisDe, joursEntre, decalerMois, finDeMois, derniersMois, periodePrecedente, etatCohorte, mediane,
  NON_ASSIGNE,
} from '../src/lib/pipelineDashboard.js';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('dates : jour, mois, écart, décalage, fin de mois', () => {
  assert.equal(jourDe('2026-11-17T08:30:00+00:00'), '2026-11-17');
  assert.equal(jourDe('n/a'), null);
  assert.equal(moisDe('2026-11-17'), '2026-11');
  assert.equal(joursEntre('2026-10-31', '2026-11-30'), 30);
  assert.equal(joursEntre('2026-11-10', '2026-11-01'), -9);
  assert.equal(joursEntre(null, '2026-11-01'), null);
  assert.equal(decalerMois('2026-01', -1), '2025-12');
  assert.equal(decalerMois('2026-11', 2), '2027-01');
  assert.equal(finDeMois('2026-02'), '2026-02-28');
  assert.equal(finDeMois('2028-02'), '2028-02-29');
  assert.deepEqual(derniersMois('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(periodePrecedente(['2026-11']), ['2026-10']);
  assert.deepEqual(periodePrecedente(['2026-10', '2026-09', '2026-11']), ['2026-06', '2026-07', '2026-08']);
});

test('etatCohorte : en cours tant que le mois court, provisoire 30 jours après sa fin, puis définitif', () => {
  assert.equal(etatCohorte(['2026-11'], '2026-11-17'), 'en_cours');
  assert.equal(etatCohorte(['2026-11'], '2026-11-30'), 'en_cours');
  assert.equal(etatCohorte(['2026-10'], '2026-11-17'), 'provisoire');
  assert.equal(etatCohorte(['2026-10'], '2026-11-29'), 'provisoire');
  assert.equal(etatCohorte(['2026-10'], '2026-11-30'), 'definitif');
  assert.equal(etatCohorte(['2026-08', '2026-09'], '2026-11-17'), 'definitif');
});

test('médiane', () => {
  assert.equal(mediane([]), null);
  assert.equal(mediane([12]), 12);
  assert.equal(mediane([30, 2, 12]), 12);
  assert.equal(mediane([2, 10, 14, 40]), 12);
});

// ---------------------------------------------------------------------------
// Jeu d'essai : deux commerciaux, octobre et novembre 2026
// ---------------------------------------------------------------------------

const PHIL = 'c-phil';
const MICH = 'c-mich';
const WEB = 's-web';
const BAO = 's-bao';

const lead = (id, extra) => ({
  id, created_date: '2026-10-05', assigned_user_id: PHIL, source_id: WEB,
  won_date: null, status_is_won: false, status_is_final: false, status_changed_at: null,
  is_long_term_project: false, last_followup_date: null, last_interaction_at: null, quote_sent_date: null,
  ...extra,
});

const LEADS = [
  // Reçu en octobre, signé en novembre, 23 jours plus tard (dans les 30 jours)
  lead('a', { created_date: '2026-10-20', won_date: '2026-11-12' }),
  // Reçu en octobre, signé en novembre, 37 jours plus tard (hors des 30 jours)
  lead('b', { created_date: '2026-10-02', won_date: '2026-11-08', assigned_user_id: MICH, source_id: BAO }),
  // Reçu en novembre, signé le jour même, devis antérieur au lead : compte en vente, pas en délai
  lead('c', { created_date: '2026-11-03', won_date: '2026-11-03' }),
  // Reçu en novembre, devis en attente relancé il y a 5 jours
  lead('d', { created_date: '2026-11-04', last_followup_date: '2026-11-12T10:00:00Z', assigned_user_id: MICH }),
  // Reçu en septembre, devis en attente jamais relancé (1er devis le 10/09)
  lead('e', { created_date: '2026-09-01' }),
  // Reçu en novembre, encore « Nouveau », sans commercial
  lead('f', { created_date: '2026-11-15', assigned_user_id: null, source_id: null }),
  // Reçu en novembre, RDV planifié mais plus de RDV actif
  lead('g', { created_date: '2026-11-06' }),
  // Projet MT-LT avec un devis en attente : hors portefeuille
  lead('h', { created_date: '2026-06-01', is_long_term_project: true }),
  // Gagné par Pennylane sans won_date : daté par la validation du devis
  lead('i', { created_date: '2026-10-25', assigned_user_id: MICH, source_id: BAO }),
];

const card = (lead_id, column_key, extra = {}) => ({
  lead_id, column_key, total_amount: 0, devis_count: 0, has_active_rdv: false,
  first_quote_date: null, quotes_validated_at: null, ...extra,
});

const CARDS = [
  card('a', 'gagne', { total_amount: 8000, devis_count: 1, first_quote_date: '2026-10-28' }),
  card('b', 'gagne', { total_amount: 5000, devis_count: 1, first_quote_date: '2026-10-15' }),
  card('c', 'gagne', { total_amount: 3000, devis_count: 1, first_quote_date: '2026-11-01' }),
  card('d', 'devis_envoye', { total_amount: 6000, devis_count: 1, first_quote_date: '2026-11-07' }),
  card('e', 'devis_envoye', { total_amount: 4000, devis_count: 1, first_quote_date: '2026-09-10' }),
  card('f', 'nouveau'),
  card('g', 'rdv_planifie', { has_active_rdv: false }),
  card('h', 'devis_envoye', { total_amount: 9000, devis_count: 1, first_quote_date: '2026-06-10' }),
  card('i', 'gagne', { total_amount: 2000, devis_count: 1, first_quote_date: '2026-10-27', quotes_validated_at: '2026-11-02T09:00:00Z' }),
];

const RDVS = [
  { lead_id: 'a', scheduled_date: '2026-10-24' },
  { lead_id: 'd', scheduled_date: '2026-11-06' },
  { lead_id: 'g', scheduled_date: '2026-11-10' },
  { lead_id: 'inconnu', scheduled_date: '2026-11-11' }, // lead supprimé : ignoré
];

const DEVIS = [
  { lead_id: 'a', quote_date: '2026-10-28', amount_ht: 8000 },
  { lead_id: 'b', quote_date: '2026-10-15', amount_ht: 5000 },
  { lead_id: 'c', quote_date: '2026-11-01', amount_ht: 3000 },
  { lead_id: 'd', quote_date: '2026-11-07', amount_ht: 6000 },
  { lead_id: 'i', quote_date: '2026-10-27', amount_ht: 2000 },
];

const COMMERCIALS = [{ id: PHIL, full_name: 'Philippe' }, { id: MICH, full_name: 'Michel' }];
const SOURCES = [{ id: WEB, name: 'Site Web' }, { id: BAO, name: 'Bouche-à-oreille' }];

const dash = (extra = {}) => buildPipelineDashboard({
  leads: LEADS, cards: CARDS, rdvs: RDVS, devis: DEVIS, commercials: COMMERCIALS, sources: SOURCES,
  mois: ['2026-11'], aujourdhui: '2026-11-17', ...extra,
});

// ---------------------------------------------------------------------------
// Événements de la période
// ---------------------------------------------------------------------------

test('entreprise : les événements de novembre, quel que soit le mois d’arrivée du lead', () => {
  const { actuel, precedent } = dash().entreprise;
  assert.equal(actuel.leads, 4); // c, d, f, g
  assert.equal(actuel.rdv, 2); // d, g (le RDV d'un lead inconnu est ignoré)
  assert.equal(actuel.devis, 2); // c, d
  assert.equal(actuel.montantDevis, 9000);
  assert.equal(actuel.ventes, 4); // a, b, c, i — a, b et i sont des leads d'octobre
  assert.equal(actuel.ca, 18000);
  // Octobre
  assert.equal(precedent.leads, 3); // a, b, i
  assert.equal(precedent.rdv, 1);
  assert.equal(precedent.devis, 3);
  assert.equal(precedent.ventes, 0);
  assert.equal(precedent.ca, 0);
});

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

test('gagnés à 30 jours : compte les leads REÇUS dans la période, pas les ventes de la période', () => {
  const { precedent } = dash().entreprise;
  // Octobre : a (23 j) et i (8 j) dans les 30 jours, b (37 j) hors délai
  assert.equal(precedent.gagnes30, 2);
  assert.equal(precedent.etat, 'provisoire');
  assert.ok(Math.abs(precedent.tauxGagnes30 - (2 / 3) * 100) < 1e-9);
});

test('période en cours : un décompte, jamais un taux', () => {
  const { actuel } = dash().entreprise;
  assert.equal(actuel.etat, 'en_cours');
  assert.equal(actuel.gagnes30, 1); // c
  assert.equal(actuel.tauxGagnes30, null);
});

test('délai de signature : ventes de la période, hors lead saisi après son devis', () => {
  const { actuel } = dash().entreprise;
  // a = 23 j, b = 37 j, i = 8 j ; c exclu (devis du 01/11 antérieur au lead du 03/11)
  assert.equal(actuel.ventesMesurees, 3);
  assert.equal(actuel.delaiSignature, 23);
});

test('gagné sans won_date : daté par la validation du devis', () => {
  const index = indexerLeads(LEADS, CARDS);
  assert.equal(index.get('i').gagneLe, '2026-11-02');
  assert.equal(index.get('i').montantGagne, 2000);
  assert.equal(index.get('d').gagne, false);
});

// ---------------------------------------------------------------------------
// Commerciaux, par mois, sources
// ---------------------------------------------------------------------------

test('commerciaux : une ligne par commercial, la vente va au commercial du lead', () => {
  const { commerciaux } = dash();
  assert.deepEqual(commerciaux.map((c) => c.nom), ['Philippe', 'Michel', 'Non assigné']);
  const phil = commerciaux[0];
  assert.equal(phil.actuel.leads, 2); // c, g
  assert.equal(phil.actuel.ventes, 2); // a, c
  assert.equal(phil.actuel.ca, 11000);
  assert.equal(phil.precedent.leads, 1); // a
  const mich = commerciaux[1];
  assert.equal(mich.actuel.ventes, 2); // b, i
  assert.equal(mich.actuel.ca, 7000);
  assert.equal(mich.actuel.rdv, 1);
  const sans = commerciaux[2];
  assert.equal(sans.id, NON_ASSIGNE);
  assert.equal(sans.actuel.leads, 1);
});

test('la somme des lignes commerciaux retombe sur l’entreprise', () => {
  const d = dash();
  for (const champ of ['leads', 'rdv', 'devis', 'montantDevis', 'ventes', 'ca', 'gagnes30']) {
    const somme = d.commerciaux.reduce((s, c) => s + c.actuel[champ], 0);
    assert.equal(somme, d.entreprise.actuel[champ], champ);
  }
});

test('vue par mois : 6 mois finissant au dernier mois choisi, pour tous et par commercial', () => {
  const { parMois } = dash();
  assert.deepEqual(parMois.tous.map((l) => l.mois), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  const octobre = parMois.tous[4];
  assert.equal(octobre.leads, 3);
  assert.equal(octobre.gagnes30, 2);
  assert.equal(octobre.etat, 'provisoire');
  assert.equal(parMois.tous[3].etat, 'definitif');
  assert.equal(parMois.tous[5].etat, 'en_cours');
  assert.equal(parMois.parCommercial[MICH][5].ca, 7000);
  assert.equal(parMois.parCommercial[PHIL][4].leads, 1);
});

test('sources : même lecture, triées par CA signé', () => {
  const { sources } = dash();
  assert.deepEqual(sources.map((s) => s.nom), ['Site Web', 'Bouche-à-oreille', 'Sans source']);
  assert.equal(sources[0].actuel.ca, 11000);
  assert.equal(sources[1].actuel.ca, 7000);
  assert.equal(sources[2].actuel.leads, 1);
});

test('filtre sources : tout le tableau de bord se restreint aux leads de ces sources', () => {
  const d = dash({ sourceIds: [BAO] });
  assert.equal(d.entreprise.actuel.ventes, 2);
  assert.equal(d.entreprise.actuel.ca, 7000);
  assert.equal(d.entreprise.actuel.rdv, 0);
  assert.deepEqual(d.commerciaux.map((c) => c.nom), ['Michel']);
});

test('rôle commercial : il ne voit que ses leads', () => {
  const d = dash({ seulCommercialId: MICH });
  assert.deepEqual(d.commerciaux.map((c) => c.nom), ['Michel']);
  assert.equal(d.entreprise.actuel.ca, 7000);
  assert.deepEqual(d.portefeuille.lignes.map((l) => l.nom), ['Michel']);
});

// ---------------------------------------------------------------------------
// Portefeuille
// ---------------------------------------------------------------------------

test('portefeuille : ce qui attend aujourd’hui, hors projets MT-LT', () => {
  const { lignes, total } = dash().portefeuille;
  const phil = lignes.find((l) => l.id === PHIL);
  assert.equal(phil.devisEnAttente, 1); // e — h est un projet MT-LT
  assert.equal(phil.montantEnAttente, 4000);
  assert.equal(phil.devisSansRelance, 1); // 1er devis le 10/09, aucune relance
  assert.equal(phil.rdvAReplanifier, 1); // g
  const mich = lignes.find((l) => l.id === MICH);
  assert.equal(mich.devisEnAttente, 1);
  assert.equal(mich.devisSansRelance, 0); // relancé il y a 5 jours
  const sans = lignes.find((l) => l.id === NON_ASSIGNE);
  assert.equal(sans.aContacter, 1);
  assert.deepEqual(total, { aContacter: 1, rdvAReplanifier: 1, devisEnAttente: 2, montantEnAttente: 10000, devisSansRelance: 1 });
  // Le plus de devis sans relance en tête, « Non assigné » en dernier
  assert.deepEqual(lignes.map((l) => l.nom), ['Philippe', 'Michel', 'Non assigné']);
});

test('portefeuille : un devis en attente sans aucune date de contact est « sans relance »', () => {
  const d = buildPipelineDashboard({
    leads: [lead('z', { created_date: '2026-11-10' })],
    cards: [card('z', 'devis_envoye', { total_amount: 100 })],
    rdvs: [], devis: [], commercials: COMMERCIALS, sources: SOURCES, mois: ['2026-11'], aujourdhui: '2026-11-17',
  });
  assert.equal(d.portefeuille.total.devisSansRelance, 1);
});

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

test('tendance : 12 mois de CA signé finissant au dernier mois choisi', () => {
  const { tendance } = dash();
  assert.equal(tendance.length, 12);
  assert.equal(tendance.at(-1).mois, '2026-11');
  assert.equal(tendance.at(-1).ca, 18000);
  assert.equal(tendance[0].mois, '2025-12');
});

test('période de plusieurs mois : comparée à la période de même longueur qui précède', () => {
  const d = dash({ mois: ['2026-10', '2026-11'] });
  assert.deepEqual(d.periode.precedente, ['2026-08', '2026-09']);
  assert.equal(d.entreprise.actuel.leads, 7);
  assert.equal(d.entreprise.precedent.leads, 1); // e
});

test('org sans Pennylane : les devis émis se lisent sur les leads', () => {
  const devis = devisDepuisLeads([
    { id: 'x', quote_sent_date: '2026-11-05', order_amount_ht: '1200.50' },
    { id: 'y', quote_sent_date: null, order_amount_ht: 900 },
  ]);
  assert.deepEqual(devis, [{ lead_id: 'x', quote_date: '2026-11-05', amount_ht: 1200.5 }]);
});

test('debutDesDonnees : couvre la période précédente et les 12 mois de tendance', () => {
  assert.equal(debutDesDonnees(['2026-11']), '2025-12-01');
  // 14 mois choisis : la période précédente remonte plus loin que la tendance
  const quatorze = derniersMois('2026-11', 14);
  assert.equal(debutDesDonnees(quatorze), '2024-08-01');
});

test('mesurer : sans donnée, des zéros et aucun taux', () => {
  const m = mesurer({ index: new Map(), rdvs: [], devis: [], mois: ['2026-09'], aujourdhui: '2026-11-17' });
  assert.equal(m.leads, 0);
  assert.equal(m.tauxGagnes30, null);
  assert.equal(m.delaiSignature, null);
});
