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
import { CHANTIER_STATUSES, getChantierAmount } from '@services/chantiers.service';
import { comparerCartesChantier } from '@/lib/chantierCardDate';
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

  const [selectedChantier, setSelectedChantier] = useState(null);
  // La modale lit le chantier dans la liste FRAÎCHE, pas dans l'instantané du clic :
  // une planification d'installation avance le statut en base (syncCardStateOnCreate)
  // sans fermer la modale, et le CTA « À planifier » restait affiché sur un chantier
  // déjà passé en Planification. Repli sur l'instantané si la carte sort de la liste.
  const modalChantier = useMemo(() => {
    if (!selectedChantier) return null;
    return chantiers.find((c) => c.id === selectedChantier.id) || selectedChantier;
  }, [chantiers, selectedChantier]);
  const canEdit = can('chantiers', 'edit');

  // Colonnes visibles selon le rôle
  const visibleColumns = useMemo(() => {
    const statuses = effectiveRole === 'technicien'
      ? CHANTIER_STATUSES.filter((s) => TECHNICIEN_STATUSES.includes(s.value))
      : CHANTIER_STATUSES.filter((s) => s.value !== 'facture');
    return statuses.map((s) => ({ id: s.value, label: s.label, color: s.color, hint: s.hint }));
  }, [effectiveRole]);

  // Filtrer par rôle avant de passer au KanbanBoard, puis trier selon ce que la bande
  // de la carte affiche (règle unique : comparerCartesChantier) : à replanifier d'abord,
  // puis les cartes datées, la plus récente en haut, puis les cartes sans date.
  const roleFilteredChantiers = useMemo(() => {
    let result = chantiers;
    if (effectiveRole === 'commercial' && user?.id) {
      result = result.filter((c) => c.assigned_user_id === user.id);
    }
    if (effectiveRole === 'technicien') {
      result = result.filter((c) => TECHNICIEN_STATUSES.includes(c.chantier_status));
    }
    return [...result].sort(comparerCartesChantier);
  }, [chantiers, effectiveRole, user?.id]);

  const searchFilter = useCallback((chantier, query) => {
    const term = query.toLowerCase();
    const fields = [
      chantier.first_name, chantier.last_name,
      chantier.address, chantier.postal_code, chantier.city,
      chantier.equipment_type_label, chantier.label,
    ];
    return fields.some((f) => f && f.toLowerCase().includes(term));
  }, []);

  const columnAmount = useCallback(
    (items) => items.reduce((sum, c) => sum + getChantierAmount(c), 0),
    [],
  );

  const renderCard = useCallback((chantier) => (
    <ChantierCard chantier={chantier} onClick={setSelectedChantier} />
  ), []);

  // Sous le titre de chaque colonne : ce que l'étape veut dire.
  const headerExtra = useCallback(
    (column) => (column.hint ? <p className="text-[11px] leading-4 text-gray-400">{column.hint}</p> : null),
    [],
  );

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
      headerExtra={headerExtra}
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
      {modalChantier && (
        <ChantierModal
          chantier={modalChantier}
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
