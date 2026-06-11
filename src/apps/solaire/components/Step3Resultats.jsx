// src/apps/solaire/components/Step3Resultats.jsx
// Étape 3 : pipeline de calcul complet (optimiseur → scénarios → financement
// → tableau annuel). Le surplus n'est JAMAIS valorisé en € (spec §1).
import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, Zap, Car, Save } from 'lucide-react';
import { formatEuro } from '@lib/utils';
import {
  computeMonthly, yearlyEconomy, monthlyPayment, buildYearlyTable,
  optimize, buildScenarios, costFromGrid, maxPowerKwc, panelsCount,
  simultaneityCoeff, evMonthlyConsumption,
} from '../lib/pvEngine';
import ScenarioCards from './ScenarioCards';
import MonthlyChart from './MonthlyChart';
import FinancingModule from './FinancingModule';
import TableauAnnuel from './TableauAnnuel';
import SaveSimulationModal from './SaveSimulationModal';

export default function Step3Resultats({
  state, config, pvgisLoading, pvgisError, onRetryPvgis, onSelectKwc, onFinancing, onBack, onSave, isSaving,
}) {
  const { conso, ev, roof, pvgis, selectedKwc, financing } = state;
  const [showSaveModal, setShowSaveModal] = useState(false);

  // --- Conso effective (+ VE linéarisé, spec §8.6 : AVANT l'optimiseur) ---
  const evMonthly = ev.enabled
    ? evMonthlyConsumption({
        kmPerYear: Number(ev.kmPerYear) || 0,
        kwhPer100km: Number(ev.kwhPer100km) || 0,
        homeChargeShare: config.ev.home_charge_share,
      })
    : 0;

  const consoMonthly = useMemo(
    () => conso.monthly.map((v) => (Number(v) || 0) + evMonthly),
    [conso.monthly, evMonthly],
  );

  const coeff = simultaneityCoeff(
    { preset: conso.preset, ecsBonus: conso.ecsBonus, evBonus: ev.enabled && ev.pilotedCharge },
    config.simultaneity,
  );

  const priceKwh = Number(conso.priceKwh) || 0;
  const rate = typeof financing.rate === 'number' ? financing.rate : NaN;
  const years = Number(financing.years);
  const deposit = Number(financing.deposit) || 0;
  const financingOk = Number.isFinite(rate) && rate >= 0 && Number.isFinite(years) && years > 0;
  const chargerPrice = ev.enabled && ev.addCharger && config.ev.charger_price !== null
    ? config.ev.charger_price
    : 0;

  // --- Optimiseur + scénarios (aucun appel PVGIS : linéarité 1 kWc) ---
  const results = useMemo(() => {
    if (!pvgis?.e_m) return null;
    const stepKwc = config.panel_power_wc / 1000;
    const maxKwc = maxPowerKwc(Number(roof.surfaceM2) || 0, config.panel_area_m2, config.panel_power_wc);
    if (maxKwc < stepKwc) return null;
    // Critère = recouvrement théorique AVANT coefficient (cf. doc optimize) —
    // le coefficient plafonnerait le taux sous le seuil et forcerait le minimum.
    const { recommendedKwc } = optimize({
      eM1kwc: pvgis.e_m, consoMonthly,
      threshold: config.autoconso_threshold, maxKwc, stepKwc,
    });
    const scenarios = buildScenarios({ recommendedKwc, stepKwc, maxKwc }).map((s) => {
      const m = computeMonthly({ eM1kwc: pvgis.e_m, powerKwc: s.kwc, consoMonthly, coeff });
      const economyYear1 = yearlyEconomy({
        autoconsoAnnual: m.totals.autoconso, priceKwh,
        inflationRate: config.inflation_rate, degradationRate: config.degradation_rate, yearN: 1,
      });
      const gridCost = costFromGrid(config.cost_grid, s.kwc);
      let avgMonthlyEffort = null;
      if (gridCost !== null && financingOk) {
        const capital = Math.max(0, gridCost + chargerPrice - deposit);
        const t = buildYearlyTable({
          autoconsoAnnual: m.totals.autoconso, priceKwh,
          inflationRate: config.inflation_rate, degradationRate: config.degradation_rate,
          horizonYears: config.horizon_years, capital, annualRate: rate, loanYears: years,
        });
        avgMonthlyEffort = t.indicators.avgMonthlyEffortDuringLoan;
      }
      return {
        ...s,
        panels: panelsCount(s.kwc, config.panel_power_wc),
        tauxAutoconso: m.totals.tauxAutoconso,
        surplusPct: m.totals.prod > 0 ? m.totals.surplus / m.totals.prod : 0,
        economyYear1,
        avgMonthlyEffort,
      };
    });
    return { recommendedKwc, scenarios };
  }, [pvgis, consoMonthly, coeff, priceKwh, roof.surfaceM2, config, financingOk, rate, years, deposit, chargerPrice]);

  // --- Scénario actif + détails (chart, financement, tableau) ---
  const activeKwc = results && results.scenarios.some((s) => s.kwc === selectedKwc)
    ? selectedKwc
    : results?.recommendedKwc ?? null;

  const active = useMemo(() => {
    if (!pvgis?.e_m || activeKwc === null) return null;
    return computeMonthly({ eM1kwc: pvgis.e_m, powerKwc: activeKwc, consoMonthly, coeff });
  }, [pvgis, activeKwc, consoMonthly, coeff]);

  const gridCost = activeKwc !== null ? costFromGrid(config.cost_grid, activeKwc) : null;
  const baseCost = financing.manualCost ?? (gridCost !== null ? Math.round(gridCost) : null);
  const totalCost = baseCost !== null ? baseCost + chargerPrice : null;
  const capital = totalCost !== null ? Math.max(0, totalCost - deposit) : null;
  const mensualite = capital !== null && financingOk
    ? monthlyPayment({ capital, annualRate: rate, years })
    : null;

  const economyYear1Active = active
    ? yearlyEconomy({
        autoconsoAnnual: active.totals.autoconso, priceKwh,
        inflationRate: config.inflation_rate, degradationRate: config.degradation_rate, yearN: 1,
      })
    : 0;

  const table = useMemo(() => {
    if (!active || capital === null || !financingOk) return null;
    return buildYearlyTable({
      autoconsoAnnual: active.totals.autoconso, priceKwh,
      inflationRate: config.inflation_rate, degradationRate: config.degradation_rate,
      horizonYears: config.horizon_years, capital, annualRate: rate, loanYears: years,
    });
  }, [active, capital, financingOk, priceKwh, config, rate, years]);

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
  if (!pvgis || !results || !active) {
    return (
      <div className="card text-sm text-secondary-600 py-8 text-center">
        Données incomplètes — revenir aux étapes précédentes.
        <div className="mt-3">
          <button onClick={onBack} className="btn-primary">Retour</button>
        </div>
      </div>
    );
  }

  const totalConsoAnnual = active.totals.conso;
  const evAnnual = Math.round(evMonthly * 12);

  return (
    <div className="space-y-5">
      {/* Récap */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-xs text-secondary-500">Production an 1</p>
            <p className="font-bold text-secondary-900">{Math.round(active.totals.prod).toLocaleString('fr-FR')} kWh</p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">Consommation</p>
            <p className="font-bold text-secondary-900">{Math.round(totalConsoAnnual).toLocaleString('fr-FR')} kWh</p>
            {evAnnual > 0 && (
              <p className="text-[11px] text-secondary-500 flex items-center justify-center gap-1">
                <Car className="w-3 h-3" /> dont VE : {evAnnual.toLocaleString('fr-FR')} kWh/an
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-secondary-500">Autoconsommation</p>
            <p className="font-bold text-secondary-900">{Math.round(active.totals.tauxAutoconso * 100)} %</p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">Facture couverte</p>
            <p className="font-bold text-secondary-900">{Math.round(active.totals.tauxAutoproduction * 100)} %</p>
          </div>
        </div>
        <p className="text-xs text-secondary-500 mt-3 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 flex-shrink-0 text-[#F5C542]" />
          Économie an 1 : <span className="font-semibold text-secondary-800">{formatEuro(Math.round(economyYear1Active))}</span>
          — le surplus est compté comme perdu (0 €), approche volontairement conservatrice.
        </p>
      </div>

      {/* Scénarios */}
      <ScenarioCards scenarios={results.scenarios} activeKwc={activeKwc} onSelect={onSelectKwc} />

      {/* Graphique mensuel */}
      <MonthlyChart monthly={active} consoMonthly={consoMonthly} />

      {/* Financement */}
      <FinancingModule
        financing={financing}
        onFinancing={onFinancing}
        gridCost={gridCost}
        chargerPrice={chargerPrice}
        totalCost={totalCost}
        capital={capital}
        mensualite={mensualite}
        economyYear1={economyYear1Active}
      />

      {/* Tableau annuel + cumul */}
      {table ? (
        <TableauAnnuel table={table} loanYears={years} horizonYears={config.horizon_years} />
      ) : (
        <div className="card text-sm text-secondary-600">
          Renseigner le coût de l'installation (et un taux/durée valides) pour générer le tableau annuel.
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <button
          onClick={() => setShowSaveModal(true)}
          className="btn-primary flex-1 py-3 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> Enregistrer la simulation
        </button>
      </div>

      <SaveSimulationModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        isSaving={isSaving}
        onSave={async ({ clientName, comment }) => {
          await onSave({
            clientName,
            comment,
            results: {
              recommendedKwc: results.recommendedKwc,
              selectedKwc: activeKwc,
              tauxAutoconso: Math.round(active.totals.tauxAutoconso * 1000) / 1000,
              tauxAutoproduction: Math.round(active.totals.tauxAutoproduction * 1000) / 1000,
              economyYear1: Math.round(economyYear1Active),
              mensualite: mensualite !== null ? Math.round(mensualite * 100) / 100 : null,
              capital,
              indicators: table
                ? {
                    avgMonthlyEffortDuringLoan: Math.round(table.indicators.avgMonthlyEffortDuringLoan * 100) / 100,
                    neutralityYear: table.indicators.neutralityYear,
                    cumulAtLoanEnd: Math.round(table.indicators.cumulAtLoanEnd),
                    totalGainAtHorizon: Math.round(table.indicators.totalGainAtHorizon),
                  }
                : null,
            },
          });
          setShowSaveModal(false);
        }}
      />
    </div>
  );
}
