/**
 * ChantierKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Board kanban 5 colonnes pour le suivi des chantiers.
 * Pas de drag & drop en Phase 1 (transitions via boutons dans la modale).
 *
 * @version 1.1.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useChantiers } from '@/shared/hooks/useChantiers';
import { useLeadCommercials } from '@/shared/hooks/useLeads';
import { CHANTIER_STATUSES } from '@/shared/services/chantiers.service';
import { ChantierCard } from './ChantierCard';
import { ChantierModal } from './ChantierModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function KanbanColumn({ status, chantiers, onChantierClick, commercialsMap }) {
  const count = chantiers.length;
  const totalAmount = chantiers.reduce(
    (sum, c) => sum + (Number(c.order_amount_ht) || Number(c.estimated_revenue) || 0),
    0,
  );

  return (
    <div className="flex flex-col bg-gray-50 rounded-xl min-w-0 flex-1 border border-gray-200">
      {/* Header colonne */}
      <div className="px-3 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: status.color }}
            />
            <h3 className="font-semibold text-sm text-gray-800 truncate">
              {status.label}
            </h3>
          </div>
          <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        <p className={`text-xs mt-1 ${totalAmount > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
          {new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
          }).format(totalAmount)}
        </p>
      </div>

      {/* Liste cartes */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] max-h-[calc(100vh-280px)]">
        {chantiers.map((chantier) => (
          <ChantierCard
            key={chantier.id}
            chantier={chantier}
            onClick={onChantierClick}
            commercialsMap={commercialsMap}
          />
        ))}

        {count === 0 && (
          <p className="text-xs text-gray-400 text-center py-6 italic">
            Aucun chantier
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

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

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedChantier, setSelectedChantier] = useState(null);

  // Permissions : can edit chantiers (pas edit_own seulement)
  const canEdit = can('chantiers', 'edit');

  // Technicien : voit seulement planification + réalisé
  const TECHNICIEN_STATUSES = ['planification', 'realise'];

  // Colonnes visibles selon le rôle
  const visibleStatuses = useMemo(() => {
    if (effectiveRole === 'technicien') {
      return CHANTIER_STATUSES.filter(
        (s) => TECHNICIEN_STATUSES.includes(s.value),
      );
    }
    // Tous les autres rôles voient toutes les colonnes (sauf facture, déjà filtré)
    return CHANTIER_STATUSES.filter((s) => s.value !== 'facture');
  }, [effectiveRole]);

  // Filtrer côté client : scope par rôle + recherche texte
  const filteredChantiers = useMemo(() => {
    let result = chantiers;

    // Commercial : voir uniquement ses propres chantiers
    if (effectiveRole === 'commercial' && user?.id) {
      result = result.filter((c) => c.assigned_user_id === user.id);
    }

    // Technicien : voir uniquement planification + réalisé
    if (effectiveRole === 'technicien') {
      result = result.filter((c) => TECHNICIEN_STATUSES.includes(c.chantier_status));
    }

    // Recherche texte
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter((c) => {
        const fields = [
          c.first_name,
          c.last_name,
          c.postal_code,
          c.city,
          c.equipment_type_label,
        ];
        return fields.some((f) => f && f.toLowerCase().includes(term));
      });
    }

    return result;
  }, [chantiers, searchTerm, effectiveRole, user?.id]);

  // Grouper par statut
  const columnData = useMemo(() => {
    const map = {};
    for (const status of CHANTIER_STATUSES) {
      map[status.value] = [];
    }
    for (const chantier of filteredChantiers) {
      if (map[chantier.chantier_status]) {
        map[chantier.chantier_status].push(chantier);
      }
    }
    return map;
  }, [filteredChantiers]);

  const handleChantierClick = useCallback((chantier) => {
    setSelectedChantier(chantier);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedChantier(null);
  }, []);

  const handleUpdated = useCallback(() => {
    refresh();
  }, [refresh]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {searchTerm.trim()
            ? `${filteredChantiers.length} / ${chantiers.length} chantier${chantiers.length !== 1 ? 's' : ''}`
            : `${chantiers.length} chantier${chantiers.length !== 1 ? 's' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          {/* Recherche */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-[220px] pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors min-h-[40px]"
              placeholder="Rechercher un chantier..."
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={refresh}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Board kanban */}
      <div className="flex gap-3 pb-4">
        {visibleStatuses.map((status) => (
          <KanbanColumn
            key={status.value}
            status={status}
            chantiers={columnData[status.value] || []}
            onChantierClick={handleChantierClick}
            commercialsMap={commercialsMap}
          />
        ))}
      </div>

      {/* Modale chantier */}
      {selectedChantier && (
        <ChantierModal
          chantier={selectedChantier}
          onClose={handleModalClose}
          onUpdated={handleUpdated}
          effectiveRole={effectiveRole}
          canEditAll={canEdit}
        />
      )}
    </div>
  );
}

export default ChantierKanban;
