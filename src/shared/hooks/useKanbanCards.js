/**
 * useKanbanCards.js — Majord'home Artisan
 * ============================================================================
 * Hook React Query pour la vue majordhome_kanban_cards.
 * Retourne toutes les cartes (1 lead peut produire 1-2 cartes).
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { kanbanService } from '@services/kanban.service';
import { kanbanCardKeys } from './cacheKeys';

/**
 * @returns {{ cards, isLoading, error, refetch }}
 */
export function useKanbanCards() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: kanbanCardKeys.all(orgId),
    queryFn: async () => {
      const { data, error } = await kanbanService.getKanbanCards(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return {
    cards: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
