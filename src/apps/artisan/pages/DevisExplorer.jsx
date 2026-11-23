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
import { AlertTriangle, EyeOff, FileText, Link2, Plus } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useQuotesExplorer, useQuoteDismissals } from '@hooks/usePennylane';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { QuoteExplorerCard } from '@apps/artisan/components/devis/QuoteExplorerCard';
import { AttachQuoteToLeadModal } from '@apps/artisan/components/devis/AttachQuoteToLeadModal';
import { CreateLeadFromQuoteModal } from '@apps/artisan/components/devis/CreateLeadFromQuoteModal';
import { EXPLORER_VIEWS, filterExplorerRows, compterVues, sansReponseDepuis } from '@/lib/quotesExplorer';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { formatEuro, formatRelativeFR } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';

const COLUMNS = [
  { id: 'pending', label: 'En attente', color: '#d97706' },
  { id: 'expired', label: 'Expiré', color: '#a16207' },
  { id: 'accepted', label: 'Accepté', color: '#1d4ed8' },
  { id: 'invoiced', label: 'Facturé', color: '#0f766e' },
];

// Le balayage tourne toutes les 5 min : au-delà d'une heure, ce ne sont plus
// des données un peu en retard, c'est une douzaine de passages manqués.
const STALE_AFTER_MS = 60 * 60 * 1000;

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
  // Cibles des modales : liste de devis (sélection groupée) ou [carte cliquée].
  const [attachRows, setAttachRows] = useState(null);
  const [createRows, setCreateRows] = useState(null);

  const { rows, syncedAt, isLoading, error, refetch } = useQuotesExplorer({
    enabled: isOrgAdmin && pennylaneActive,
  });
  const { dismissQuotes, isDismissing, restoreQuote } = useQuoteDismissals();

  const [sansReponse, setSansReponse] = useState(false);
  const compteurs = useMemo(() => compterVues(rows), [rows]);
  const visibleRows = useMemo(() => {
    const parVue = filterExplorerRows(rows, view);
    if (!sansReponse) return parVue;
    const d = new Date();
    const aujourdhui = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return parVue.filter((r) => sansReponseDepuis(r, aujourdhui));
  }, [rows, view, sansReponse]);

  // Sélection groupée (2026-09-16) : « Rattacher N devis » et « Créer le lead
  // avec N devis » agissent sur les cases cochées — avant, seule « Écarter »
  // lisait la sélection et chaque « Créer le lead » fabriquait son propre lead
  // (vécu DURAND : 2 devis, 2 clics, 2 leads).
  const selectedRows = useMemo(
    () => visibleRows.filter((r) => selectedIds.has(r.id)),
    [visibleRows, selectedIds],
  );
  // Un lead = un client : la création groupée exige un client Pennylane unique.
  const sameCustomer = selectedRows.length > 0
    && selectedRows.every((r) => r.customer_id && r.customer_id === selectedRows[0].customer_id);

  if (!isOrgAdmin || !pennylaneActive) return <Navigate to="/" replace />;

  const clearSelection = () => setSelectedIds(new Set());

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
      <PageHeader title="Devis Pennylane" />

      {error && (
        <div className="p-4 rounded-lg bg-st-attente-bg text-st-attente flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            {/* La page ne lit plus Pennylane en direct mais la table jumelle :
                une erreur ici vient de Supabase (RLS, réseau), pas de PL. */}
            <p className="text-sm font-medium">Devis indisponibles</p>
            <p className="text-sm">{error?.message || 'Erreur inconnue'}</p>
          </div>
          <button type="button" onClick={() => refetch()}
            className="text-sm font-medium underline shrink-0">Réessayer</button>
        </div>
      )}

      {/* Fraîcheur de la projection. La page ne lit plus Pennylane en direct :
          si le balayage s'arrête, elle continuerait d'afficher des données
          périmées avec assurance — « aucun nouveau devis » là où il faut lire
          « je ne sais plus ». Ce bandeau est ce qui rend la table jumelle
          acceptable, pas un ornement. */}
      {!isLoading && !error && (
        syncedAt ? (
          <p className="text-xs text-secondary-400">
            Dernière synchronisation {formatRelativeFR(syncedAt)}
          </p>
        ) : (
          <div className="p-3 rounded-lg bg-st-attente-bg text-st-attente text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            Aucune synchronisation Pennylane connue — cette page ne reflète
            peut-être rien du tout.
          </div>
        )
      )}

      {syncedAt && (Date.now() - new Date(syncedAt).getTime()) > STALE_AFTER_MS && (
        <div className="p-3 rounded-lg bg-st-attente-bg text-st-attente text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Les devis affichés datent de plus d&apos;une heure — la synchronisation
          Pennylane est peut-être arrêtée.
        </div>
      )}

      {/* Onglets de vue */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Vue des devis"
          value={view}
          onChange={(v) => { setView(v); setSelectedIds(new Set()); }}
          options={VIEW_TABS.map((tab) => ({ value: tab.id, label: tab.label, count: isLoading ? undefined : compteurs[tab.id] }))}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={sansReponse}
          title="Devis en attente ou expirés depuis plus de 21 jours, parmi ceux des 90 derniers jours affichés ici"
          onClick={() => { setSansReponse((v) => !v); setSelectedIds(new Set()); }}
          className={sansReponse ? 'border-primary-200 bg-primary-50 text-primary-800 hover:bg-primary-50' : undefined}
        >
          Sans réponse depuis 21 j
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-secondary-400">Chargement des devis...</div>
      ) : (
        <KanbanBoard
          items={visibleRows}
          columns={COLUMNS}
          groupBy="status"
          emptyMessage="Aucun devis"
          vide={{ icon: FileText, message: sansReponse ? 'Aucun devis sans réponse depuis 21 jours.' : 'Aucun devis dans cette vue.' }}
          searchPlaceholder="Rechercher un client, un n° de devis..."
          searchFilter={(row, query) => {
            const q = query.toLowerCase();
            return [row.customer_name, row.quote_number, row.label, row.lead_name]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q));
          }}
          columnAmount={(items) => items.reduce((sum, r) => sum + (Number(r.amount_ht) || 0), 0)}
          headerLeft={
            selectedRows.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setAttachRows(selectedRows)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-sm font-medium text-white"
                >
                  <Link2 className="w-4 h-4" />
                  Rattacher {selectedRows.length} devis
                </button>
                <button
                  type="button"
                  disabled={!sameCustomer}
                  title={sameCustomer ? undefined : 'Les devis cochés doivent appartenir au même client Pennylane'}
                  onClick={() => setCreateRows(selectedRows)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-sm font-medium text-secondary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  Créer le lead ({selectedRows.length} devis)
                </button>
                <button
                  type="button"
                  disabled={isDismissing}
                  onClick={() => handleDismiss(selectedRows.map((r) => r.id))}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-sm font-medium text-secondary-700 disabled:opacity-50"
                >
                  <EyeOff className="w-4 h-4" />
                  Écarter {selectedRows.length} devis
                </button>
              </div>
            ) : (
              <p className="text-sm text-secondary-500">
                {visibleRows.length} devis · {formatEuro(visibleRows.reduce((s, r) => s + (Number(r.amount_ht) || 0), 0))}
              </p>
            )
          }
          renderCard={(row) => (
            <QuoteExplorerCard
              row={row}
              selected={selectedIds.has(row.id)}
              onToggleSelect={toggleSelect}
              onAttach={(row) => setAttachRows([row])}
              onCreateLead={(row) => setCreateRows([row])}
              onDismiss={handleDismiss}
              onRestore={handleRestore}
            />
          )}
        />
      )}

      {attachRows && (
        <AttachQuoteToLeadModal
          quotes={attachRows}
          onClose={() => setAttachRows(null)}
          onAttached={() => { setAttachRows(null); clearSelection(); refetch(); }}
        />
      )}

      {createRows && (
        <CreateLeadFromQuoteModal
          quotes={createRows}
          onClose={() => setCreateRows(null)}
          onCreated={() => { setCreateRows(null); clearSelection(); refetch(); }}
        />
      )}
    </div>
  );
}
