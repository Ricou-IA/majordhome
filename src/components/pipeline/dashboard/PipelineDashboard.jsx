/**
 * PipelineDashboard.jsx — onglet Dashboard du pipeline.
 * Trois blocs, trois règles de comptage (cf. src/lib/pipelineDashboard.js) :
 *   1. le mois de l'entreprise — les événements de la période ;
 *   2. les commerciaux — activité de la période + cycle de vie des leads reçus ;
 *   3. à traiter maintenant — le portefeuille ouvert aujourd'hui.
 * Ce composant assemble ; il ne calcule rien.
 */

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useDashboardFilters } from '@hooksPipeline/useDashboardFilters';
import { usePipelineDashboard } from '@hooks/usePipelineDashboard';
import { useLeadSources } from '@hooks/useLeads';
import { DashboardFilters } from './DashboardFilters';
import { MoisEntreprise } from './MoisEntreprise';
import { TableauCommerciaux } from './TableauCommerciaux';
import { PortefeuilleOuvert } from './PortefeuilleOuvert';
import { CaSigneChart } from './CaSigneChart';
import { TableauSources } from './TableauSources';

/**
 * @param {Object} props
 * @param {(commercialId: string) => void} [props.onOuvrirKanban] ouvre le Kanban sur un commercial
 */
export function PipelineDashboard({ onOuvrirKanban }) {
  const { filters, updateMonths, updateSourceIds, resetFilters } = useDashboardFilters();
  const { sources } = useLeadSources();
  const { dashboard, isLoading, error, refetch, estCommercial } = usePipelineDashboard({
    mois: filters.months,
    sourceIds: filters.sourceIds,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardFilters
          filters={filters}
          sources={sources}
          onUpdateMonths={updateMonths}
          onUpdateSourceIds={updateSourceIds}
          onReset={resetFilters}
        />
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md p-2 text-secondary-500 hover:bg-secondary-100 hover:text-secondary-700"
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        // Des chiffres inconnus ne s'affichent pas à zéro : on dit que la lecture a échoué.
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Les chiffres du pipeline n’ont pas pu être chargés.</p>
            <button type="button" onClick={() => refetch()} className="mt-1 font-medium underline">
              Réessayer
            </button>
          </div>
        </div>
      ) : isLoading || !dashboard ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-secondary-400" />
        </div>
      ) : (
        <>
          <MoisEntreprise entreprise={dashboard.entreprise} precedente={dashboard.periode.precedente} />

          <TableauCommerciaux dashboard={dashboard} estCommercial={estCommercial} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <PortefeuilleOuvert portefeuille={dashboard.portefeuille} onOuvrirKanban={onOuvrirKanban} />
            </div>
            <div className="xl:col-span-2">
              <CaSigneChart tendance={dashboard.tendance} periode={dashboard.periode.mois} />
            </div>
          </div>

          <TableauSources sources={dashboard.sources} />
        </>
      )}
    </div>
  );
}
