/**
 * kanbanEntretienSav.js — colonnes du kanban Entretien & SAV (Eric 2026-11-23)
 * ============================================================================
 * Module PUR, testé `scripts/kanban-entretien-sav.test.mjs`.
 *
 * Le statut d'une carte (`workflow_status`) ne change pas ; seul son AFFICHAGE change :
 *   - « Demande de contrat » sort du kanban : une proposition de contrat se suit dans
 *     l'espace Contrats, pas dans le suivi des interventions ;
 *   - « Pièces commandées » n'a plus sa colonne : la carte SAV va dans « À planifier »
 *     avec sa bande de date HACHURÉE tant que les pièces ne sont pas reçues — comme la
 *     pose provisoire d'un chantier (bande hachurée tant que les appros manquent).
 * ============================================================================
 */

/** Colonne affichée d'une carte ; null = la carte n'est pas montrée dans le kanban. */
export function colonneDeCarte(item) {
  const statut = item?.workflow_status;
  if (!statut || statut === 'demande_contrat') return null;
  if (statut === 'pieces_commandees') return 'a_planifier';
  return statut;
}

/** Colonnes du registre qui n'ont plus de colonne à l'écran. */
export const COLONNES_SANS_COLONNE = ['demande_contrat', 'pieces_commandees'];

/**
 * SAV en attente de pièces : commandées (ou devis accepté, pièces à commander) et pas
 * encore reçues. La carte reste planifiable ; sa bande est hachurée.
 * @param {{ intervention_type?: string, workflow_status?: string, parts_order_status?: (string|null) } | null | undefined} item
 * @returns {boolean}
 */
export function piecesEnAttente(item) {
  if (!item || item.intervention_type !== 'sav') return false;
  if (['realise', 'facture'].includes(item.workflow_status)) return false;
  if (item.parts_order_status === 'recu') return false;
  return item.parts_order_status === 'commande' || item.workflow_status === 'pieces_commandees';
}

/**
 * Statut visé quand une carte est déposée dans une colonne. Un SAV « Devis envoyé » déposé
 * dans « À planifier » passe par l'acceptation du devis (statut `pieces_commandees`,
 * affiché dans « À planifier »).
 * @param {{ workflow_status?: string }} item
 * @param {string} colonne  colonne de dépôt
 * @returns {string}
 */
export function statutViseParDepot(item, colonne) {
  if (colonne === 'a_planifier' && item?.workflow_status === 'devis_envoye') return 'pieces_commandees';
  return colonne;
}
