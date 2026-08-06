// src/apps/thermique/pages/ThermiqueHistorique.jsx
// Historique des études thermiques (pattern Historique.jsx Solaire) : liste paginée
// avec recherche par titre, réouverture à l'identique via /thermique?etude=<id>
// (LOAD_STUDY côté wizard), rapport PDF direct et suppression avec confirmation.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Thermometer, Plus, FolderOpen, FileDown, Trash2, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useThermalStudies, useThermalStudyMutations } from '@hooks/useThermalStudies';
import { useDebounce } from '@hooks/useDebounce';
import { thermalService } from '@services/thermal.service';
import { SearchBar } from '@apps/artisan/components/shared/SearchBar';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { formatDateShortFR } from '@lib/utils';
import { logger } from '@lib/logger';
import { DEFAULT_PAGE_SIZE } from '@lib/constants';
import { buildThermiqueConfig } from '../lib/thermiqueConfig';
import { telechargerRapportThermique, resoudMachineRapport } from '../lib/rapportExport';

const STATUS_BADGES = {
  draft: { label: 'Brouillon', className: 'bg-amber-100 text-amber-800' },
  completed: { label: 'Terminée', className: 'bg-emerald-100 text-emerald-800' },
};

function StatusBadge({ status }) {
  const badge = STATUS_BADGES[status] ?? { label: status || '—', className: 'bg-secondary-100 text-secondary-600' };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
      {badge.label}
    </span>
  );
}

export default function ThermiqueHistorique() {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const { settings } = useOrgSettings();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [toDelete, setToDelete] = useState(null);
  const [pdfId, setPdfId] = useState(null); // étude dont le rapport est en cours de génération
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useThermalStudies({ search: debouncedSearch, page });
  const { deleteStudy } = useThermalStudyMutations();

  const rows = data?.rows ?? [];
  const count = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / DEFAULT_PAGE_SIZE));

  // Le rapport se génère depuis les résultats FIGÉS de l'étude — mêmes chiffres qu'à
  // l'enregistrement, sans repasser par le wizard. La liste ne charge pas la colonne `input`
  // (jsonb lourd × 20 lignes) : on récupère l'étude complète au clic seulement.
  const handlePdf = async (study) => {
    setPdfId(study.id);
    try {
      const { data: full, error } = await thermalService.getById(organization?.id, study.id);
      if (error || !full) throw error || new Error('étude introuvable');
      if (!full.results?.bilan) throw new Error('cette étude ne porte pas de résultats enregistrés');
      await telechargerRapportThermique({
        input: full.input ?? {},
        resultats: {
          bilan: full.results.bilan,
          thetaE: full.results.thetaE,
          pac: full.results.pac ?? null,
          engineVersion: full.engine_version ?? null,
        },
        config: buildThermiqueConfig(settings),
        settings,
        machine: await resoudMachineRapport(full.input?.pac),
      });
      toast.success('Rapport PDF généré');
    } catch (err) {
      logger.error('[thermique] rapport PDF depuis l’historique échoué', err);
      toast.error(`Rapport PDF impossible : ${err?.message ?? 'erreur inconnue'}`);
    } finally {
      setPdfId(null);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteStudy.mutateAsync(toDelete.id);
      toast.success('Étude supprimée');
      setToDelete(null);
    } catch (err) {
      toast.error(`Échec de la suppression : ${err.message}`);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Historique des études thermiques</h1>
          <p className="text-secondary-600 text-sm">
            {count} étude{count > 1 ? 's' : ''} — rechargeables à l'identique
          </p>
        </div>
        <button onClick={() => navigate('/thermique')} className="btn-primary flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Nouvelle étude
        </button>
      </div>

      <SearchBar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        placeholder="Rechercher par titre…"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <Thermometer className="w-10 h-10 text-secondary-300 mx-auto" />
          <p className="text-sm text-secondary-500">
            {debouncedSearch
              ? 'Aucune étude ne correspond à cette recherche.'
              : 'Aucune étude enregistrée pour le moment.'}
          </p>
          {!debouncedSearch && (
            <button
              onClick={() => navigate('/thermique')}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Nouvelle étude
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-secondary-200 bg-white">
            <table className="w-full">
              <thead className="bg-secondary-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Titre</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Statut</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-secondary-500 uppercase">Total</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Moteur</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-secondary-500 uppercase">Modifiée le</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {rows.map((study) => {
                  const total = study.results?.bilan?.total;
                  return (
                    <tr key={study.id} className="hover:bg-secondary-50 transition-colors">
                      <td className="px-3 py-3">
                        <p className="text-sm font-medium text-secondary-900 truncate max-w-[280px]">
                          {study.title || 'Étude sans titre'}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={study.status} />
                      </td>
                      <td className="px-3 py-3 text-sm text-secondary-700 text-right whitespace-nowrap">
                        {total != null ? `${Math.round(total).toLocaleString('fr-FR')} W` : '—'}
                      </td>
                      <td className="px-3 py-3 text-sm text-secondary-600 whitespace-nowrap">
                        {study.engine_version ? `v${study.engine_version}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-sm text-secondary-600 whitespace-nowrap">
                        {formatDateShortFR(study.updated_at)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => navigate(`/thermique?etude=${study.id}`)}
                            className="btn-primary flex items-center gap-1.5 text-sm"
                          >
                            <FolderOpen className="w-3.5 h-3.5" /> Ouvrir
                          </button>
                          <button
                            onClick={() => handlePdf(study)}
                            disabled={pdfId != null || total == null}
                            title={total == null
                              ? 'Aucun résultat enregistré pour cette étude'
                              : 'Télécharger le rapport PDF'}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-secondary-300 text-secondary-700 rounded-lg hover:bg-secondary-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {pdfId === study.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <FileDown className="w-3.5 h-3.5" />}
                            PDF
                          </button>
                          <button
                            onClick={() => setToDelete(study)}
                            className="p-2 rounded-lg text-secondary-400 hover:text-secondary-700 hover:bg-secondary-100"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
        title="Supprimer l'étude"
        description={`Supprimer définitivement l'étude « ${toDelete?.title || 'Étude sans titre'} » ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteStudy.isPending}
      />
    </div>
  );
}
