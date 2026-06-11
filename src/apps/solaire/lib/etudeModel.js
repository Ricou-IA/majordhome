// src/apps/solaire/lib/etudeModel.js
// SOURCE UNIQUE du pipeline de calcul d'une étude : consommé par l'étape
// Résultats (UI) ET par la génération du PDF (étape 3 live / historique
// rechargé) — garantit des chiffres strictement identiques partout.
// PUR : aucun import React/Supabase (testé via node --test).
import {
  computeMonthly, yearlyEconomy, monthlyPayment, buildYearlyTable,
  optimize, buildScenarios, costFromGrid, maxPowerKwc, panelsCount,
  simultaneityCoeff, evMonthlyConsumption,
} from './pvEngine.js';

export const PRESET_LABELS = {
  presence_journee: 'Présence en journée',
  presence_partielle: 'Présence partielle',
  absent_journee: 'Absent en journée',
};

/** Note de prudence affichée à côté du point mort (UI + PDF). Le taux
 * d'autoconsommation est une HYPOTHÈSE déclarative (presets simultanéité),
 * pas une mesure — il sera calibré avec les relevés réels à l'usage. */
export const NATIONAL_AUTOCONSO_BENCHMARK = 'hypothèse prudente, à confirmer par les relevés réels la première année';

/**
 * Construit le modèle complet d'une étude depuis les saisies + PVGIS + config.
 * Retourne null si les données sont incomplètes (pas de PVGIS, toiture < 1 panneau).
 */
export function buildEtudeModel({ roof, conso, ev, financing, selectedKwc, pvgis, config }) {
  if (!pvgis?.e_m) return null;

  // --- Conso effective (+ VE linéarisé AVANT l'optimiseur, spec §8.6) ---
  const evMonthly = ev.enabled
    ? evMonthlyConsumption({
        kmPerYear: Number(ev.kmPerYear) || 0,
        kwhPer100km: Number(ev.kwhPer100km) || 0,
        homeChargeShare: config.ev.home_charge_share,
      })
    : 0;
  const consoMonthly = conso.monthly.map((v) => (Number(v) || 0) + evMonthly);

  const coeff = simultaneityCoeff(
    { preset: conso.preset, ecsBonus: conso.ecsBonus, evBonus: ev.enabled && ev.pilotedCharge },
    config.simultaneity,
  );

  // Décomposition du coefficient (transparence du résultat, UI + PDF)
  const coeffParts = {
    preset: conso.preset,
    presetValue: config.simultaneity[conso.preset] ?? config.simultaneity.presence_partielle,
    ecsApplied: Boolean(conso.ecsBonus),
    evApplied: Boolean(ev.enabled && ev.pilotedCharge),
    bonusEcs: config.simultaneity.bonus_ecs,
    bonusVe: config.simultaneity.bonus_ve,
    cap: config.simultaneity.cap,
  };
  coeffParts.rawSum = coeffParts.presetValue
    + (coeffParts.ecsApplied ? coeffParts.bonusEcs : 0)
    + (coeffParts.evApplied ? coeffParts.bonusVe : 0);
  coeffParts.capped = coeffParts.rawSum > coeffParts.cap + 1e-9;

  const priceKwh = Number(conso.priceKwh) || 0;
  const rate = typeof financing.rate === 'number' ? financing.rate : NaN;
  const years = Number(financing.years);
  const deposit = Number(financing.deposit) || 0;
  const financingOk = Number.isFinite(rate) && rate >= 0 && Number.isFinite(years) && years > 0;
  const chargerPrice = ev.enabled && ev.addCharger && config.ev.charger_price !== null
    ? config.ev.charger_price
    : 0;

  // --- Optimiseur + scénarios (plafond d'offre : min(toiture, max_power_kwc)) ---
  const stepKwc = config.panel_power_wc / 1000;
  const roofMaxKwc = maxPowerKwc(Number(roof.surfaceM2) || 0, config.panel_area_m2, config.panel_power_wc);
  const maxKwc = Math.min(roofMaxKwc, config.max_power_kwc ?? 9);
  if (maxKwc < stepKwc) return null;

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

  // --- Scénario actif + détails (chart, financement, tableau) ---
  const activeKwc = scenarios.some((s) => s.kwc === selectedKwc) ? selectedKwc : recommendedKwc;
  const active = computeMonthly({ eM1kwc: pvgis.e_m, powerKwc: activeKwc, consoMonthly, coeff });

  // Recouvrement mensuel théorique (avant coefficient) : autoconso = Σ min × coeff
  // → Σ min = autoconso / coeff. Affiché pour expliquer tauxAutoconso = recouvrement × coeff.
  const overlapRatio = active.totals.prod > 0 && coeff > 0
    ? active.totals.autoconso / coeff / active.totals.prod
    : 0;

  const gridCost = costFromGrid(config.cost_grid, activeKwc);
  const baseCost = financing.manualCost ?? (gridCost !== null ? Math.round(gridCost) : null);
  const totalCost = baseCost !== null ? baseCost + chargerPrice : null;
  const capital = totalCost !== null ? Math.max(0, totalCost - deposit) : null;
  const mensualite = capital !== null && financingOk
    ? monthlyPayment({ capital, annualRate: rate, years })
    : null;

  const economyYear1 = yearlyEconomy({
    autoconsoAnnual: active.totals.autoconso, priceKwh,
    inflationRate: config.inflation_rate, degradationRate: config.degradation_rate, yearN: 1,
  });

  const table = capital !== null && financingOk
    ? buildYearlyTable({
        autoconsoAnnual: active.totals.autoconso, priceKwh,
        inflationRate: config.inflation_rate, degradationRate: config.degradation_rate,
        horizonYears: config.horizon_years, capital, annualRate: rate, loanYears: years,
      })
    : null;

  // --- Lecture investisseur (rattachée au FINANCEMENT, pas à la performance
  // de l'actif — séparation demandée par Eric 2026-06-11) ---
  // +1 point de taux d'autoconsommation = production × 1 % × prix (économie an 1)
  const sensitivityPerAutoconsoPoint = active.totals.prod * 0.01 * priceKwh;
  // Taux d'autoconso (sur production) où l'économie an 1 couvre l'annuité de crédit
  const breakEvenAutoconsoRate = table && active.totals.prod > 0 && priceKwh > 0
    ? table.rows[0].annuity / (active.totals.prod * priceKwh)
    : null;
  // Plafond comportemental : recouvrement × coefficient max (pilotage parfait)
  const maxAchievableAutoconso = overlapRatio * coeffParts.cap;
  // Type ROCE — rendement de l'actif : économie ÷ coût total, indépendant du financement
  const assetYieldYear1 = totalCost ? economyYear1 / totalCost : null;
  let horizonEconomies = 0;
  for (let n = 1; n <= config.horizon_years; n++) {
    horizonEconomies += yearlyEconomy({
      autoconsoAnnual: active.totals.autoconso, priceKwh,
      inflationRate: config.inflation_rate, degradationRate: config.degradation_rate, yearN: n,
    });
  }
  const assetYieldAvg = totalCost ? horizonEconomies / config.horizon_years / totalCost : null;
  // Type ROE — rendement des fonds propres : gain net après crédit ÷ apport.
  // Apport 0 = effet de levier maximal (aucun capital immobilisé), ROE non défini.
  const netGainYear1 = table ? -table.rows[0].effortNet : null;
  const equityYieldYear1 = table && deposit > 0
    ? (economyYear1 - table.rows[0].annuity) / deposit
    : null;
  const fullCredit = financingOk && deposit === 0;
  // Objectif pilotage : delta entre l'autoconso actuelle et le plafond
  // atteignable, exprimé en points ET en €/an (vulgarisation Eric 2026-06-11)
  const pilotageDeltaPoints = Math.max(0, Math.round((maxAchievableAutoconso - active.totals.tauxAutoconso) * 100));
  const pilotageDeltaEuros = pilotageDeltaPoints * sensitivityPerAutoconsoPoint;

  return {
    evMonthly,
    evAnnual: Math.round(evMonthly * 12),
    consoMonthly,
    coeff,
    coeffParts,
    overlapRatio,
    priceKwh,
    rate,
    years,
    deposit,
    financingOk,
    chargerPrice,
    stepKwc,
    roofMaxKwc,
    maxKwc,
    cappedByOffer: roofMaxKwc > maxKwc,
    recommendedKwc,
    scenarios,
    activeKwc,
    activePanels: panelsCount(activeKwc, config.panel_power_wc),
    active,
    gridCost,
    baseCost,
    totalCost,
    capital,
    mensualite,
    economyYear1,
    table,
    sensitivityPerAutoconsoPoint,
    breakEvenAutoconsoRate,
    maxAchievableAutoconso,
    assetYieldYear1,
    assetYieldAvg,
    netGainYear1,
    equityYieldYear1,
    fullCredit,
    pilotageDeltaPoints,
    pilotageDeltaEuros,
  };
}
