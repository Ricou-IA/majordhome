/**
 * kanban.service.js — Majord'home Artisan
 * ============================================================================
 * Accès à la vue public.majordhome_kanban_cards (Phase 1 pipeline multi-devis).
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Récupère toutes les cartes Kanban pour une org.
 * 1 lead peut produire 1 ou 2 cartes selon mix devis.
 *
 * @param {string} orgId
 * @returns {Promise<Array>} cartes avec { card_key, lead_id, org_id, card_type,
 *   column_key, devis_count, total_amount, pending_count, accepted_count, refused_count }
 */
async function getKanbanCards(orgId) {
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('majordhome_kanban_cards')
    .select('*')
    .eq('org_id', orgId);
  if (error) throw error;
  return data || [];
}

export const kanbanService = {
  getKanbanCards: (orgId) => withErrorHandling(() => getKanbanCards(orgId), 'kanban.getKanbanCards'),
};
