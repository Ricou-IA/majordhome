/**
 * DevisExplorer.jsx — page /devis
 * ============================================================================
 * Explorateur des devis Pennylane par statut. Sert à repérer et traiter les
 * devis jamais rattachés à un lead.
 * Accès org_admin uniquement (un devis PL ne porte pas de commercial).
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useQuotesExplorer, useQuoteDismissals } from '@hooks/usePennylane';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { QuoteExplorerCard } from '@apps/artisan/components/devis/QuoteExplorerCard';
import { EXPLORER_VIEWS, filterExplorerRows } from '@/lib/quotesExplorer';
import { formatEuro } from '@/lib/utils';

const COLUMNS = [
  { id: 'pending', label: 'En attente', color: '#d97706' },
  { id: 'expired', label: 'Expiré', color: '#a16207' },
  { id: 'accepted', label: 'Accepté', color: '#1d4ed8' },
  { id: 'invoiced', label: 'Facturé', color: '#0f766e' },
];

const VIEW_TABS = [
  { id: EXPLORER_VIEWS.ORPHANS, label: 'Orphelins' },
  { id: EXPLORER_VIEWS.ALL, label: 'Tous' },
  { id: EXPLORER_VIEWS.DISMISSED, label: 'Écartés' },
];

export default function DevisExplorer() {
  const { isOrgAdmin } = useAuth();
  const pennylaneActive = usePennylaneEnabled();

  const [view, setView] = useState(EXPLORER_VIEWS.ORPHANS);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [attachRow, setAttachRow] = useState(null);
  const [createRow, setCreateRow] = useState(null);

  const { rows, truncated, scanned, isLoading, error, refetch } = useQuotesExplorer({
    enabled: isOrgAdmin && pennylaneActive,
  });
  const { dismissQuotes, isDismissing, restoreQuote } = useQuoteDismissals();

  const visibleRows = useMemo(() => filterExplorerRows(rows, view), [rows, view]);

  if (!isOrgAdmin || !pennylaneActive) return <Navigate to="/" replace />;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDismiss = async (rowOrIds) => {
    const ids = Array.isArray(rowOrIds) ? rowOrIds : [rowOrIds.id];
    try {
      await dismissQuotes({ quoteIds: ids, reason: 'hors pipeline' });
      setSelectedIds(new Set());
      toast.success(ids.length > 1 ? `${ids.length} devis écartés` : 'Devis écarté');
    } catch (e) {
      toast.error(`Écartement impossible : ${e?.message || e}`);
    }
  };

  const handleRestore = async (row) => {
    try {
      await restoreQuote(row.id);
      toast.success('Devis réintégré');
    } catch (e) {
      toast.error(`Réintégration impossible : ${e?.message || e}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Devis Pennylane</h1>
          <p className="text-secondary-600">
            Devis des 90 derniers jours et leur rattachement au pipeline.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-amber-50 text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">Pennylane injoignable</p>
            <p className="text-sm">{error?.message || 'Erreur inconnue'}</p>
          </div>
          <button type="button" onClick={() => refetch()}
            className="text-sm font-medium underline shrink-0">Réessayer</button>
        </div>
      )}

      {truncated && (
        <div className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
          Affichage partiel : {scanned} devis analysés (plafond de scan atteint).
          Les devis les plus anciens de la fenêtre peuvent manquer.
        </div>
      )}

      {/* Onglets de vue */}
      <div className="flex items-center gap-1 border-b border-secondary-200">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setView(tab.id); setSelectedIds(new Set()); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === tab.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-gray-400">Chargement des devis...</div>
      ) : (
        <KanbanBoard
          items={visibleRows}
          columns={COLUMNS}
          groupBy="status"
          emptyMessage="Aucun devis"
          searchPlaceholder="Rechercher un client, un n° de devis..."
          searchFilter={(row, query) => {
            const q = query.toLowerCase();
            return [row.customer_name, row.quote_number, row.label, row.lead_name]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q));
          }}
          columnAmount={(items) => items.reduce((sum, r) => sum + (Number(r.amount_ht) || 0), 0)}
          headerLeft={
            selectedIds.size > 0 ? (
              <button
                type="button"
                disabled={isDismissing}
                onClick={() => handleDismiss([...selectedIds])}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-sm font-medium text-secondary-700 disabled:opacity-50"
              >
                <EyeOff className="w-4 h-4" />
                Écarter {selectedIds.size} devis
              </button>
            ) : (
              <p className="text-sm text-gray-500">
                {visibleRows.length} devis · {formatEuro(visibleRows.reduce((s, r) => s + (Number(r.amount_ht) || 0), 0))}
              </p>
            )
          }
          renderCard={(row) => (
            <QuoteExplorerCard
              row={row}
              selected={selectedIds.has(row.id)}
              onToggleSelect={toggleSelect}
              onAttach={setAttachRow}
              onCreateLead={setCreateRow}
              onDismiss={handleDismiss}
              onRestore={handleRestore}
            />
          )}
        />
      )}

      {/* Les modales Rattacher / Créer le lead sont branchées ici par les
          Tasks 9 et 10. `attachRow` / `createRow` sont déjà câblés sur les
          boutons de carte — la page reste buildable en attendant. */}
    </div>
  );
}
