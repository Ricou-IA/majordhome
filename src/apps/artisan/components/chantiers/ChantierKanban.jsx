/**
 * ChantierKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Board kanban pour le suivi des chantiers.
 * Utilise le composant générique KanbanBoard.
 *
 * @version 2.0.0 - Refactoring KanbanBoard
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useChantiers } from '@hooks/useChantiers';
import { useLeadCommercials } from '@hooks/useLeads';
import { CHANTIER_STATUSES } from '@services/chantiers.service';
import { KanbanBoard } from '@/apps/artisan/components/shared/KanbanBoard';
import { ChantierCard } from './ChantierCard';
import { ChantierModal } from './ChantierModal';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const TECHNICIEN_STATUSES = ['planification', 'realise'];

export function ChantierKanban() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { can, effectiveRole } = useCanAccess();

  const { chantiers, isLoading, refresh } = useChantiers(orgId);
  const { commercials } = useLeadCommercials(orgId);

  // Map { userId → { initials, name, colorIndex } } pour les badges
  const commercialsMap = useMemo(() => {
    const map = {};
    commercials.forEach((c, i) => {
      const parts = (c.full_name || '').trim().split(/\s+/);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (parts[0] || '?').substring(0, 2).toUpperCase();
      map[c.id] = { initials, name: c.full_name, colorIndex: i };
    });
    return map;
  }, [commercials]);

  const [selectedChantier, setSelectedChantier] = useState(null);
  const canEdit = can('chantiers', 'edit');

  // Colonnes visibles selon le rôle
  const visibleColumns = useMemo(() => {
    const statuses = effectiveRole === 'technicien'
      ? CHANTIER_STATUSES.filter((s) => TECHNICIEN_STATUSES.includes(s.value))
      : CHANTIER_STATUSES.filter((s) => s.value !== 'facture');
    return statuses.map((s) => ({ id: s.value, label: s.label, color: s.color }));
  }, [effectiveRole]);

  // Filtrer par rôle avant de passer au KanbanBoard
  const roleFilteredChantiers = useMemo(() => {
    let result = chantiers;
    if (effectiveRole === 'commercial' && user?.id) {
      result = result.filter((c) => c.assigned_user_id === user.id);
    }
    if (effectiveRole === 'technicien') {
      result = result.filter((c) => TECHNICIEN_STATUSES.includes(c.chantier_status));
    }
    return result;
  }, [chantiers, effectiveRole, user?.id]);

  const searchFilter = useCallback((chantier, query) => {
    const term = query.toLowerCase();
    const fields = [
      chantier.first_name, chantier.last_name,
      chantier.postal_code, chantier.city,
      chantier.equipment_type_label,
    ];
    return fields.some((f) => f && f.toLowerCase().includes(term));
  }, []);

  const columnAmount = useCallback((items) =>
    items.reduce((sum, c) => sum + (Number(c.order_amount_ht) || Number(c.estimated_revenue) || 0), 0),
  []);

  const renderCard = useCallback((chantier) => (
    <ChantierCard
      chantier={chantier}
      onClick={setSelectedChantier}
      commercialsMap={commercialsMap}
    />
  ), [commercialsMap]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <KanbanBoard
      items={roleFilteredChantiers}
      columns={visibleColumns}
      groupBy="chantier_status"
      renderCard={renderCard}
      onCardClick={setSelectedChantier}
      searchPlaceholder="Rechercher un chantier..."
      searchFilter={searchFilter}
      columnAmount={columnAmount}
      emptyMessage="Aucun chantier"
      headerRight={
        <button
          onClick={refresh}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      }
    >
      {selectedChantier && (
        <ChantierModal
          chantier={selectedChantier}
          onClose={() => setSelectedChantier(null)}
          onUpdated={refresh}
          effectiveRole={effectiveRole}
          canEditAll={canEdit}
        />
      )}
    </KanbanBoard>
  );
}

export default ChantierKanban;
