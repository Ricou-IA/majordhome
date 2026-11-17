/**
 * kanban.service.js — Majord'home Artisan
 * ============================================================================
 * Accès à la vue public.majordhome_kanban_cards (Phase 1 pipeline multi-devis).
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';
import { fetchAllPages } from '@/lib/postgrestUtils';

/**
 * Récupère toutes les cartes Kanban pour une org.
 * 1 lead peut produire 1 ou 2 cartes selon mix devis.
 * Lecture page par page : PostgREST coupe une réponse à 1 000 lignes sans le dire,
 * et une carte absente de la liste disparaît du pipeline.
 *
 * @param {string} orgId
 * @returns {Promise<Array>} cartes avec { card_key, lead_id, org_id, card_type,
 *   column_key, devis_count, total_amount, pending_count, accepted_count, refused_count }
 */
async function getKanbanCards(orgId) {
  if (!orgId) return [];
  return fetchAllPages((from, to) => supabase
    .from('majordhome_kanban_cards')
    .select('*')
    .eq('org_id', orgId)
    .order('card_key')
    .range(from, to));
}

export const kanbanService = {
  getKanbanCards: (orgId) => withErrorHandling(() => getKanbanCards(orgId), 'kanban.getKanbanCards'),
};
