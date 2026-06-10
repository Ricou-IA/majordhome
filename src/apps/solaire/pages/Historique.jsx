// src/apps/solaire/pages/Historique.jsx
// Historique des simulations PV. RLS : le commercial voit les siennes,
// org_admin voit tout. Rechargement à l'identique via /solaire?sim=<id>.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sun, MapPin, RotateCw, Trash2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePvSimulations, usePvSimulationMutations } from '@hooks/usePvSimulations';
import { useDebounce } from '@hooks/useDebounce';
import { SearchBar } from '@apps/artisan/components/shared/SearchBar';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { formatDateShortFR, formatEuro } from '@lib/utils';

const PAGE_SIZE = 25;

export default function Historique() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [toDelete, setToDelete] = useState(null);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = usePvSimulations({ search: debouncedSearch, page });
  const { deleteSimulation } = usePvSimulationMutations();

  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const handleDelete = async () => {
    try {
      await deleteSimulation.mutateAsync(toDelete.id);
      toast.success('Simulation supprimée');
      setToDelete(null);
    } catch (err) {
      toast.error(`Échec de la suppression : ${err.message}`);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Historique des simulations</h1>
          <p className="text-secondary-600 text-sm">
            {count} simulation{count > 1 ? 's' : ''} — rechargeables à l'identique
          </p>
        </div>
        <button onClick={() => navigate('/solaire')} className="btn-primary flex items-center gap-1.5">
          <Sun className="w-4 h-4" /> Nouvelle simulation
        </button>
      </div>

      <SearchBar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        placeholder="Rechercher par nom de client…"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-center py-10 text-sm text-secondary-500">
          {debouncedSearch
            ? 'Aucune simulation ne correspond à cette recherche.'
            : 'Aucune simulation enregistrée pour le moment.'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((sim) => {
            const r = sim.results ?? {};
            return (
              <div key={sim.id} className="card flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <p className="font-semibold text-secondary-900">{sim.client_name || 'Sans nom'}</p>
                  {sim.client_address && (
                    <p className="text-xs text-secondary-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 flex-shrink-0" /> {sim.client_address}
                    </p>
                  )}
                  <p className="text-xs text-secondary-500 mt-0.5">{formatDateShortFR(sim.created_at)}</p>
                </div>

                <div className="text-sm text-right">
                  {r.selectedKwc != null && (
                    <p className="font-semibold text-secondary-900">{r.selectedKwc} kWc</p>
                  )}
                  {r.economyYear1 != null && (
                    <p className="text-xs text-secondary-500">
                      Économie an 1 : <span className="font-medium text-secondary-700">{formatEuro(r.economyYear1)}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/solaire?sim=${sim.id}`)}
                    className="btn-primary flex items-center gap-1.5 text-sm"
                  >
                    <RotateCw className="w-3.5 h-3.5" /> Recharger
                  </button>
                  <button
                    onClick={() => setToDelete(sim)}
                    className="p-2 rounded-lg text-secondary-400 hover:text-secondary-700 hover:bg-secondary-100"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-2 rounded-lg border border-secondary-200 text-secondary-600 disabled:opacity-40 hover:bg-secondary-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-secondary-600">
                Page {page + 1} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                className="p-2 rounded-lg border border-secondary-200 text-secondary-600 disabled:opacity-40 hover:bg-secondary-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Supprimer la simulation"
        description={`Supprimer définitivement la simulation${toDelete?.client_name ? ` « ${toDelete.client_name} »` : ''} ?`}
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        loading={deleteSimulation.isPending}
      />
    </div>
  );
}
