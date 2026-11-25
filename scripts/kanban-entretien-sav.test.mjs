import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colonneDeCarte, piecesEnAttente, statutViseParDepot, zoneDeCarte, COLONNES_PAR_ZONE,
  statutApresAjoutEntretien, statutApresPiecesRecues, planifiableAvecEntretien, resumeSav,
} from '../src/lib/kanbanEntretienSav.js';

test('colonneDeCarte : demande de contrat hors kanban, pièces commandées dans « À planifier »', () => {
  assert.equal(colonneDeCarte({ workflow_status: 'demande_contrat' }), null);
  assert.equal(colonneDeCarte({ workflow_status: 'pieces_commandees' }), 'a_planifier');
  assert.equal(colonneDeCarte({ workflow_status: 'planifie' }), 'planifie');
  assert.equal(colonneDeCarte({ workflow_status: null }), null);
  assert.equal(colonneDeCarte(null), null);
});

test('piecesEnAttente : SAV commandé ou devis accepté, tant que rien n\'est reçu', () => {
  assert.equal(piecesEnAttente({ intervention_type: 'sav', workflow_status: 'pieces_commandees' }), true);
  assert.equal(piecesEnAttente({ intervention_type: 'sav', workflow_status: 'planifie', parts_order_status: 'commande' }), true);
  assert.equal(piecesEnAttente({ intervention_type: 'sav', workflow_status: 'pieces_commandees', parts_order_status: 'recu' }), false);
  assert.equal(piecesEnAttente({ intervention_type: 'sav', workflow_status: 'a_planifier' }), false);
  assert.equal(piecesEnAttente({ intervention_type: 'sav', workflow_status: 'realise', parts_order_status: 'commande' }), false);
  assert.equal(piecesEnAttente({ intervention_type: 'entretien', workflow_status: 'planifie', parts_order_status: 'commande' }), false);
});

test('statutViseParDepot : devis envoyé déposé en « À planifier » = acceptation du devis', () => {
  assert.equal(statutViseParDepot({ workflow_status: 'devis_envoye' }, 'a_planifier'), 'pieces_commandees');
  assert.equal(statutViseParDepot({ workflow_status: 'demande' }, 'a_planifier'), 'a_planifier');
  assert.equal(statutViseParDepot({ workflow_status: 'pieces_commandees' }, 'planifie'), 'planifie');
});

test('zoneDeCarte : un SAV dans le SAV, un entretien dans Entretiens, un SAV avec entretien côté Entretiens', () => {
  assert.equal(zoneDeCarte({ intervention_type: 'sav' }), 'sav');
  assert.equal(zoneDeCarte({ intervention_type: 'sav', includes_entretien: false }), 'sav');
  assert.equal(zoneDeCarte({ intervention_type: 'sav', includes_entretien: true }), 'entretien');
  assert.equal(zoneDeCarte({ intervention_type: 'entretien' }), 'entretien');
  assert.equal(zoneDeCarte(null), null);
});

test('colonnes : chaque statut affiché tombe dans une colonne de son kanban', () => {
  const statuts = ['demande', 'devis_envoye', 'pieces_commandees', 'a_planifier', 'planifie', 'realise', 'facture'];
  for (const zone of ['sav', 'entretien']) {
    for (const workflow_status of statuts) {
      const colonne = colonneDeCarte({ workflow_status }, zone);
      assert.ok(COLONNES_PAR_ZONE[zone].includes(colonne), `${zone} · ${workflow_status} → ${colonne}`);
    }
  }
  // Côté Entretiens, pas de colonne Demande ni Devis envoyé : la carte attend dans « À planifier ».
  assert.equal(colonneDeCarte({ workflow_status: 'demande' }, 'entretien'), 'a_planifier');
  assert.equal(colonneDeCarte({ workflow_status: 'devis_envoye' }, 'entretien'), 'a_planifier');
  assert.equal(colonneDeCarte({ workflow_status: 'demande' }, 'sav'), 'demande');
});

test('statutApresAjoutEntretien : une demande devient « À planifier », le reste ne bouge pas', () => {
  assert.equal(statutApresAjoutEntretien({ workflow_status: 'demande' }), 'a_planifier');
  assert.equal(statutApresAjoutEntretien({ workflow_status: 'devis_envoye' }), null);
  assert.equal(statutApresAjoutEntretien({ workflow_status: 'planifie' }), null);
  assert.equal(statutApresAjoutEntretien(null), null);
});

test('statutApresPiecesRecues : une carte planifiée ou réalisée ne revient jamais « À planifier »', () => {
  assert.equal(statutApresPiecesRecues({ workflow_status: 'pieces_commandees' }), 'a_planifier');
  assert.equal(statutApresPiecesRecues({ workflow_status: 'demande' }), 'a_planifier');
  assert.equal(statutApresPiecesRecues({ workflow_status: 'devis_envoye' }), 'a_planifier');
  assert.equal(statutApresPiecesRecues({ workflow_status: 'planifie' }), null);
  assert.equal(statutApresPiecesRecues({ workflow_status: 'realise' }), null);
  assert.equal(statutApresPiecesRecues({ workflow_status: 'facture' }), null);
  assert.equal(statutApresPiecesRecues({ workflow_status: 'a_planifier' }), null);
});

test('planifiableAvecEntretien : seulement un SAV avec entretien dont le devis n\'est pas tranché', () => {
  assert.equal(planifiableAvecEntretien({ intervention_type: 'sav', includes_entretien: true, workflow_status: 'devis_envoye' }), true);
  assert.equal(planifiableAvecEntretien({ intervention_type: 'sav', includes_entretien: true, workflow_status: 'demande' }), true);
  assert.equal(planifiableAvecEntretien({ intervention_type: 'sav', includes_entretien: false, workflow_status: 'devis_envoye' }), false);
  assert.equal(planifiableAvecEntretien({ intervention_type: 'sav', includes_entretien: true, workflow_status: 'planifie' }), false);
  assert.equal(planifiableAvecEntretien({ intervention_type: 'entretien', workflow_status: 'a_planifier' }), false);
});

test('resumeSav : ne compte que les cartes du kanban SAV, pièces commandées avec « à planifier »', () => {
  const items = [
    { intervention_type: 'sav', workflow_status: 'demande' },
    { intervention_type: 'sav', workflow_status: 'demande' },
    { intervention_type: 'sav', workflow_status: 'devis_envoye' },
    { intervention_type: 'sav', workflow_status: 'pieces_commandees' },
    { intervention_type: 'sav', workflow_status: 'a_planifier' },
    { intervention_type: 'sav', workflow_status: 'planifie' },
    { intervention_type: 'sav', workflow_status: 'realise' },
    { intervention_type: 'sav', workflow_status: 'demande', includes_entretien: true }, // passée côté Entretiens
    { intervention_type: 'entretien', workflow_status: 'a_planifier' },
    { intervention_type: 'entretien', workflow_status: 'planifie' },
  ];
  assert.deepEqual(resumeSav(items), { demandes: 2, devis: 1, aPlanifier: 2, planifies: 1 });
  assert.deepEqual(resumeSav(null), { demandes: 0, devis: 0, aPlanifier: 0, planifies: 0 });
});
