import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  motsDuNom, memeNom, propositionRemplacement, etatProjet, mentionProjet, statutApresLiaison,
} from '../src/lib/savProjet.js';
import { colonneDeCarte, resumeSav } from '../src/lib/kanbanEntretienSav.js';

const devis = (id, extra = {}) => ({
  id, quote_number: `D-${id}`, status: 'pending', date: '2026-11-18', amount_ht: 3000,
  customer_id: 77, customer_name: 'SONTAG Vincent', ...extra,
});

test('memeNom : mêmes mots sans ordre, accents ni civilité ; un nom seul ne suffit pas', () => {
  assert.deepEqual(motsDuNom('M. Sontag  Vincent'), ['sontag', 'vincent']);
  assert.equal(memeNom('SONTAG VINCENT', 'Vincent Sontag'), true);
  assert.equal(memeNom('Mme Hélène DUPRÉ', 'DUPRE HELENE'), true);
  assert.equal(memeNom('SONTAG', 'Sontag'), false);
  assert.equal(memeNom('SONTAG VINCENT', 'SONTAG PAUL'), false);
  assert.equal(memeNom(null, 'SONTAG VINCENT'), false);
});

test('propositionRemplacement : devis du client non rattachés, par customer ponté ou par nom', () => {
  const quotes = [
    devis(1, { customer_id: 77, customer_name: 'Autre libellé' }),          // ponté
    devis(2, { customer_id: 99, customer_name: 'Vincent SONTAG' }),         // même nom, non ponté
    devis(3, { customer_id: 12, customer_name: 'MARTIN Paul' }),            // autre client
    devis(4, { customer_id: 77, status: 'invoiced' }),                      // déjà facturé : pas un projet à suivre
    devis(5, { customer_id: 77, amount_ht: 80, date: '2026-11-20' }),       // petit montant : proposé quand même
  ];
  const { orphelins, projet } = propositionRemplacement({ quotes, customerIds: ['77'], nomClient: 'SONTAG VINCENT' });
  assert.deepEqual(orphelins.map((q) => q.id), [5, 1, 2]);
  assert.deepEqual(orphelins.map((q) => q.parNom), [false, false, true]);
  assert.equal(projet, null);
});

test('propositionRemplacement : devis déjà rattaché ⇒ projet existant, devis écarté ignoré', () => {
  const quotes = [devis(1), devis(2, { date: '2026-11-10' }), devis(3)];
  const linkByQuoteId = new Map([[1, { lead_id: 'lead-a', lead_name: 'Vincent SONTAG' }]]);
  const { orphelins, projet } = propositionRemplacement({
    quotes, linkByQuoteId, dismissedIds: new Set([3]), customerIds: [77], nomClient: 'x',
  });
  assert.deepEqual(orphelins.map((q) => q.id), [2]);
  assert.deepEqual(projet, { lead_id: 'lead-a', lead_name: 'Vincent SONTAG' });
});

test('propositionRemplacement : rien pour ce client ⇒ listes vides, jamais une erreur', () => {
  assert.deepEqual(propositionRemplacement({ quotes: [devis(1)], customerIds: [], nomClient: 'MARTIN PAUL' }), { orphelins: [], projet: null });
  assert.deepEqual(propositionRemplacement(), { orphelins: [], projet: null });
});

const carte = (extra = {}) => ({ intervention_type: 'sav', workflow_status: 'devis_envoye', lead_id: 'lead-a', ...extra });

test('etatProjet : pas de lead ⇒ pas de projet ; lectures inconnues ⇒ inconnu', () => {
  assert.equal(etatProjet(carte({ lead_id: null }), { chantiers: [], cartes: [] }), null);
  assert.equal(etatProjet({ intervention_type: 'entretien', lead_id: 'lead-a' }, { chantiers: [], cartes: [] }), null);
  assert.equal(etatProjet(carte(), undefined).etat, 'inconnu');
  assert.equal(etatProjet(carte(), { chantiers: [] }).etat, 'inconnu');
});

test('etatProjet : chantier > perdu > en cours ; lead sorti du pipeline ⇒ absent', () => {
  const cartes = [{ lead_id: 'lead-a', column_key: 'devis_envoye' }];
  assert.equal(etatProjet(carte(), { chantiers: [], cartes }).etat, 'en_cours');
  assert.deepEqual(
    etatProjet(carte(), { chantiers: [{ id: 'ch-1', lead_id: 'lead-a' }], cartes }),
    { leadId: 'lead-a', etat: 'chantier', chantierId: 'ch-1' },
  );
  assert.equal(etatProjet(carte(), { chantiers: [], cartes: [{ lead_id: 'lead-a', column_key: 'perdu' }] }).etat, 'perdu');
  // Deux cartes de pipeline (devis refusé + devis en attente) : le projet n'est pas perdu.
  assert.equal(etatProjet(carte(), {
    chantiers: [], cartes: [{ lead_id: 'lead-a', column_key: 'perdu' }, { lead_id: 'lead-a', column_key: 'devis_envoye' }],
  }).etat, 'en_cours');
  assert.equal(etatProjet(carte(), { chantiers: [], cartes: [{ lead_id: 'autre', column_key: 'gagne' }] }).etat, 'absent');
});

test('colonneDeCarte : la demande suit son projet tant qu\'elle n\'est pas reprise en SAV', () => {
  const avec = (etat, workflow_status = 'devis_envoye') => ({ intervention_type: 'sav', workflow_status, projet: { etat } });
  // Devis en attente : la demande est suivie dans le pipeline, elle quitte le SAV.
  assert.equal(colonneDeCarte(avec('en_cours'), 'sav'), null);
  assert.equal(colonneDeCarte(avec('en_cours', 'demande'), 'sav'), null);
  assert.equal(colonneDeCarte(avec('inconnu'), 'sav'), 'devis_envoye');
  assert.equal(colonneDeCarte(avec('perdu'), 'sav'), 'demande');
  assert.equal(colonneDeCarte(avec('chantier'), 'sav'), null);
  assert.equal(colonneDeCarte(avec('absent'), 'sav'), 'devis_envoye');
  // Carte reprise en SAV (planifiée, réalisée) : son statut fait foi, même si un chantier existe.
  assert.equal(colonneDeCarte(avec('chantier', 'planifie'), 'sav'), 'planifie');
  assert.equal(colonneDeCarte(avec('perdu', 'realise'), 'sav'), 'realise');
  // Côté Entretiens (entretien ajouté) : l'entretien reste à faire, le projet ne masque rien.
  assert.equal(colonneDeCarte(avec('chantier'), 'entretien'), 'a_planifier');
});

test('resumeSav : une demande passée en projet ou en chantier n\'attend plus, un devis refusé redevient une demande', () => {
  const items = [
    { intervention_type: 'sav', workflow_status: 'devis_envoye', projet: { etat: 'chantier' } },
    { intervention_type: 'sav', workflow_status: 'devis_envoye', projet: { etat: 'perdu' } },
    { intervention_type: 'sav', workflow_status: 'demande', projet: { etat: 'en_cours' } },
    { intervention_type: 'sav', workflow_status: 'devis_envoye', projet: { etat: 'inconnu' } },
  ];
  assert.deepEqual(resumeSav(items), { demandes: 1, devis: 1, aPlanifier: 0, planifies: 0 });
});

test('mentionProjet et statutApresLiaison', () => {
  assert.equal(mentionProjet({ etat: 'en_cours' }).texte, 'Projet · devis envoyé');
  assert.equal(mentionProjet({ etat: 'chantier' }).texte, 'Passé en chantier');
  assert.equal(mentionProjet({ etat: 'perdu' }).texte, 'Devis refusé');
  assert.equal(mentionProjet({ etat: 'absent' }), null);
  assert.equal(mentionProjet(null), null);
  assert.equal(statutApresLiaison({ workflow_status: 'demande' }), 'devis_envoye');
  assert.equal(statutApresLiaison({ workflow_status: 'a_planifier' }), null);
});
