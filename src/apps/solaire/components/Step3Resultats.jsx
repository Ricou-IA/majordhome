// src/apps/solaire/components/Step3Resultats.jsx
// Étape 3 : rendu des résultats. TOUT le calcul vient de buildEtudeModel
// (source unique partagée avec le PDF étude — chiffres identiques garantis).
// Le surplus n'est JAMAIS valorisé en € (spec §1).
import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, Zap, Car, Save, FileDown } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import { buildEtudeModel } from '../lib/etudeModel';
import ScenarioCards from './ScenarioCards';
import MonthlyChart from './MonthlyChart';
import FinancingModule from './FinancingModule';
import TableauAnnuel from './TableauAnnuel';
import SaveSimulationModal from './SaveSimulationModal';

export default function Step3Resultats({
  state, config, pvgisLoading, pvgisError, onRetryPvgis, onSelectKwc, onFinancing,
  onBack, onSave, isSaving, onGeneratePdf, isGeneratingPdf, defaultClientName,
}) {
  const { conso, ev, roof, pvgis, selectedKwc, financing } = state;
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  const model = useMemo(
    () => buildEtudeModel({ roof, conso, ev, financing, selectedKwc, pvgis, config }),
    [roof, conso, ev, financing, selectedKwc, pvgis, config],
  );

  // --- États PVGIS (critère #7 : jamais d'écran blanc) ---
  if (pvgisLoading) {
    return (
      <div className="card flex items-center justify-center gap-3 py-12 text-secondary-600">
        <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
        Interrogation PVGIS (production solaire du lieu)…
      </div>
    );
  }
  if (pvgisError) {
    return (
      <div className="card space-y-4 py-8 text-center">
        <AlertTriangle className="w-8 h-8 text-secondary-500 mx-auto" />
        <div>
          <p className="font-medium text-secondary-900">PVGIS est indisponible</p>
          <p className="text-sm text-secondary-600 mt-1">{pvgisError}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={onBack} className="px-4 py-2 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50">
            Retour
          </button>
          <button onClick={onRetryPvgis} className="btn-primary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      </div>
    );
  }
  if (!pvgis || !model) {
    return (
      <div className="card text-sm text-secondary-600 py-8 text-center">
        Données incomplètes — revenir aux étapes précédentes.
        <div className="mt-3">
          <button onClick={onBack} className="btn-primary">Retour</button>
        </div>
      </div>
    );
  }

  const buildResults = () => ({
    recommendedKwc: model.recommendedKwc,
    selectedKwc: model.activeKwc,
    tauxAutoconso: Math.round(model.active.totals.tauxAutoconso * 1000) / 1000,
    tauxAutoproduction: Math.round(model.active.totals.tauxAutoproduction * 1000) / 1000,
    economyYear1: Math.round(model.economyYear1),
    mensualite: model.mensualite !== null ? Math.round(model.mensualite * 100) / 100 : null,
    capital: model.capital,
    indicators: model.table
      ? {
          avgMonthlyEffortDuringLoan: Math.round(model.table.indicators.avgMonthlyEffortDuringLoan * 100) / 100,
          neutralityYear: model.table.indicators.neutralityYear,
          cumulAtLoanEnd: Math.round(model.table.indicators.cumulAtLoanEnd),
          totalGainAtHorizon: Math.round(model.table.indicators.totalGainAtHorizon),
        }
      : null,
  });

  return (
    <div className="space-y-5">
      {/* Récap */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-xs text-secondary-500">Production an 1</p>
            <p className="font-bold text-secondary-900">{Math.round(model.active.totals.prod).toLocaleString('fr-FR')} kWh</p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">Consommation</p>
            <p className="font-bold text-secondary-900">{Math.round(model.active.totals.conso).toLocaleString('fr-FR')} kWh</p>
            {model.evAnnual > 0 && (
              <p className="text-[11px] text-secondary-500 flex items-center justify-center gap-1">
                <Car className="w-3 h-3" /> dont VE : {model.evAnnual.toLocaleString('fr-FR')} kWh/an
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-secondary-500">Autoconsommation</p>
            <p className="font-bold text-secondary-900">{Math.round(model.active.totals.tauxAutoconso * 100)} %</p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">Facture couverte</p>
            <p className="font-bold text-secondary-900">{Math.round(model.active.totals.tauxAutoproduction * 100)} %</p>
          </div>
        </div>
        <p className="text-xs text-secondary-500 mt-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 flex-shrink-0 text-[#F5C542]" />
          Économie an 1 : <span className="font-semibold text-secondary-800">{formatEuro(Math.round(model.economyYear1))}</span>
          — le surplus est compté comme perdu (0 €), approche volontairement conservatrice.
        </p>
      </div>

      {/* Scénarios */}
      <ScenarioCards scenarios={model.scenarios} activeKwc={model.activeKwc} onSelect={onSelectKwc} />
      {model.cappedByOffer && (
        <p className="text-xs text-secondary-500 flex items-center gap-1.5 -mt-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Dimensionnement plafonné à {config.max_power_kwc} kWc (offre résidentielle — régime réglementaire
          différent au-delà). La toiture permettrait {model.roofMaxKwc} kWc.
        </p>
      )}

      {/* Graphique mensuel */}
      <MonthlyChart monthly={model.active} consoMonthly={model.consoMonthly} />

      {/* Financement */}
      <FinancingModule
        financing={financing}
        onFinancing={onFinancing}
        gridCost={model.gridCost}
        chargerPrice={model.chargerPrice}
        totalCost={model.totalCost}
        capital={model.capital}
        mensualite={model.mensualite}
        economyYear1={model.economyYear1}
      />

      {/* Tableau annuel + cumul */}
      {model.table ? (
        <TableauAnnuel table={model.table} loanYears={model.years} horizonYears={config.horizon_years} />
      ) : (
        <div className="card text-sm text-secondary-600">
          Renseigner le coût de l'installation (et un taux/durée valides) pour générer le tableau annuel.
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <button
          onClick={() => setShowPdfModal(true)}
          disabled={isGeneratingPdf}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50 disabled:opacity-50"
        >
          {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Étude PDF
        </button>
        <button
          onClick={() => setShowSaveModal(true)}
          className="btn-primary flex-1 min-w-[180px] py-3 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> Enregistrer la simulation
        </button>
      </div>

      <SaveSimulationModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        isSaving={isSaving}
        initialName={defaultClientName}
        onSave={async ({ clientName, comment }) => {
          await onSave({ clientName, comment, results: buildResults() });
          setShowSaveModal(false);
        }}
      />

      <SaveSimulationModal
        open={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        isSaving={isGeneratingPdf}
        initialName={defaultClientName}
        title="Étude personnalisée (PDF)"
        confirmLabel="Télécharger l'étude"
        showComment={false}
        onSave={async ({ clientName }) => {
          await onGeneratePdf({ clientName });
          setShowPdfModal(false);
        }}
      />
    </div>
  );
}
