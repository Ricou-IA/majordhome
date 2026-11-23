import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colonneDeCarte, piecesEnAttente, statutViseParDepot } from '../src/lib/kanbanEntretienSav.js';

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
