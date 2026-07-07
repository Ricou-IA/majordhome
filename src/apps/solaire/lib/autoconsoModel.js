// src/apps/solaire/lib/autoconsoModel.js
// Orchestrateur : SOURCE DE CALCUL UNIQUE du module autoconso (comme etudeModel).
// Assemble usageProfiles → buildLoadCurve → cascade de leviers → dimensionnement
// batterie + courbes client. Importe uniquement des modules purs siblings.
//
// Modèle de composition A (validé 2026-07-07) : les tiers déphasage (comportement /
// piloté) sont deux INTENSITÉS appliquées DEPUIS la baseline (alternatives, pas
// cumulées entre elles) ; la PAC piscine et la batterie STACKENT au-dessus du tier
// piloté. Chaque ligne de cascade affiche son gain MARGINAL vs la précédente.
// (runScenarios de scenarios.js modélise des étapes cumulatives ; il ne convient pas
// ici car les 2 tiers de déphasage sont des alternatives → staging explicite.)
//
// RÈGLE : surplus jamais valorisé en € (import évité / confort).
// Déphasage BORNÉ À LA JOURNÉE (applySolarShift, corrigé 2026-07-07) : pas de report
// d'énergie entre jours (le ballon/VE stocke ~1 jour) → cascade réaliste.
import { buildLoadCurve, computeSelfConsumption, simulateBattery, sizeBattery, monthlyFromHourly, dayTypeFromHourly } from './autoconsoEngine.js';
import { ecsDevice, veDevice, poolDevice, fromAnnualBudget, hoursMask, POOL_HOURS, PAC_HEATING_HOURS, PAC_HEATING_MONTH_WEIGHTS, veWeekendDeferrableFraction } from './usageProfiles.js';
import { applySolarShift, absorbSurplusWithLoad, applyVeWeekendShift } from './scenarios.js';

/** Défauts de cascade — « constatés » (fractions réalistes, à ajuster). */
export const CASCADE_DEFAULTS = {
  behaviorShiftFraction: 0.3,  // S1 comportement (déphasage ECS manuel partiel)
  pilotedShiftFraction: 0.9,   // S2 piloté ECS (asservissement ballon sur surplus)
  veWeekendShiftFraction: 0.7, // S2b VE : défaut si capacité batterie voiture non saisie
  weekdayChargeCap: 0.6,       // plafond de charge VE en semaine (le week-end complète sur solaire)
  poolMaxKwhPerHour: 3,        // PAC piscine — charge max absorbée par heure
  batteryCapacities: [0, 2, 4, 6, 8, 10, 12, 15],
  batteryEfficiency: 0.9,
  winterMonths: [11, 0, 1],
  summerMonths: [5, 6, 7],
};

function metrics(sc) {
  return {
    autoconsoRate: sc.autoconsoRate,
    autoproductionRate: sc.autoproductionRate,
    selfConsumedKwh: sc.selfConsumedKwh,
    importedKwh: sc.importedKwh,
    exportedKwh: sc.exportedKwh,
  };
}

/**
 * Construit les devices du foyer depuis les paramètres saisis.
 * household = { persons, veKmPerYear?, pool?({pumpKw,hoursPerDay}), pacAnnualKwh? }
 */
export function buildDevices(household) {
  const devices = [ecsDevice({ persons: household.persons })];
  if (household.veKmPerYear > 0) devices.push(veDevice({ kmPerYear: household.veKmPerYear }));
  if (household.pool) devices.push(poolDevice(household.pool));
  if (household.pacAnnualKwh > 0) {
    devices.push(fromAnnualBudget({
      name: 'pac',
      annualKwh: household.pacAnnualKwh,
      hourOfDayWeights: hoursMask(PAC_HEATING_HOURS),
      monthWeights: PAC_HEATING_MONTH_WEIGHTS,
    }));
  }
  return devices;
}

/**
 * Modèle d'autoconsommation complet du foyer (source unique UI ↔ PDF).
 * Entrées : household, monthlyConsoTotals[12] (ancres facture), baseShape[8760]
 * (talon Enedis normalisé), prodHourly[8760] (PVGIS × kWc).
 * Renvoie { baseline, cascade[], battery, byDevice, warnings, annualByMonth,
 *           dayTypeWinter, dayTypeSummer }.
 */
export function buildAutoconsoModel({ household, monthlyConsoTotals, baseShape, prodHourly, cascade = CASCADE_DEFAULTS }) {
  const devices = buildDevices(household);
  const { hourly: baseline, byDevice, warnings } = buildLoadCurve({ monthlyConsoTotals, baseShape, devices });

  const ecsCurve = byDevice.ecs;
  const veCurve = byDevice.ve || null;
  const sc = (c) => computeSelfConsumption({ prodHourly, consoHourly: c });

  // Cascade (modèle A) — chaque levier = optimisation vendable, gain MARGINAL affiché.
  const scBase = sc(baseline);
  const cascadeRows = [{ key: 'constat', label: 'Constat (sans changement)', ...metrics(scBase), deltaKwh: 0 }];
  let prev = scBase.selfConsumedKwh;

  // S1 comportement : déphasage ECS manuel partiel (depuis la baseline)
  const scBeh = sc(applySolarShift(baseline, prodHourly, ecsCurve, { fraction: cascade.behaviorShiftFraction }));
  cascadeRows.push({ key: 'behavior', label: 'Changement de comportement', ...metrics(scBeh), deltaKwh: scBeh.selfConsumedKwh - prev });
  prev = scBeh.selfConsumedKwh;

  // S2 piloté ECS : asservissement ballon sur le surplus (depuis la baseline)
  let consoRunning = applySolarShift(baseline, prodHourly, ecsCurve, { fraction: cascade.pilotedShiftFraction });
  const scPilEcs = sc(consoRunning);
  cascadeRows.push({ key: 'piloted_ecs', label: 'Déphasage piloté ECS', ...metrics(scPilEcs), deltaKwh: scPilEcs.selfConsumedKwh - prev });
  prev = scPilEcs.selfConsumedKwh;

  // S2b recharge VE week-end (domotique) : report hebdo nuits-semaine → week-end journée
  if (veCurve) {
    const veAnnualKwh = veCurve.reduce((a, b) => a + b, 0);
    const veFraction = household.veBatteryKwh > 0
      ? veWeekendDeferrableFraction({ veAnnualKwh, veBatteryKwh: household.veBatteryKwh, weekdayChargeCap: cascade.weekdayChargeCap })
      : cascade.veWeekendShiftFraction;
    consoRunning = applyVeWeekendShift(consoRunning, prodHourly, veCurve, { fraction: veFraction });
    const scVe = sc(consoRunning);
    cascadeRows.push({ key: 've_weekend', label: 'Recharge VE week-end', ...metrics(scVe), deltaKwh: scVe.selfConsumedKwh - prev });
    prev = scVe.selfConsumedKwh;
  }

  // S2c PAC piscine : absorbe le surplus restant
  if (household.pool) {
    const r = absorbSurplusWithLoad(consoRunning, prodHourly, { hourWeights: hoursMask(POOL_HOURS), maxKwhPerHour: cascade.poolMaxKwhPerHour });
    consoRunning = r.consoHourly;
    const scPool = sc(consoRunning);
    cascadeRows.push({ key: 'pool', label: 'PAC piscine', ...metrics(scPool), absorbedKwh: r.absorbedKwh, deltaKwh: scPool.selfConsumedKwh - prev });
    prev = scPool.selfConsumedKwh;
  }

  // S3 batterie : dimensionnée sur la conso optimisée (post-leviers)
  const battery = sizeBattery({ prodHourly, consoHourly: consoRunning, capacities: cascade.batteryCapacities, roundTripEfficiency: cascade.batteryEfficiency });
  const battResult = simulateBattery({ prodHourly, consoHourly: consoRunning, capacityKwh: battery.recommendedCapacityKwh, roundTripEfficiency: cascade.batteryEfficiency });
  cascadeRows.push({ key: 'battery', label: `Batterie ${battery.recommendedCapacityKwh} kWh`, ...metrics(battResult), deltaKwh: battResult.selfConsumedKwh - prev });

  return {
    baseline: metrics(scBase),
    cascade: cascadeRows,
    battery,
    byDevice,
    warnings,
    annualByMonth: monthlyFromHourly(baseline),
    dayTypeWinter: dayTypeFromHourly(baseline, { months: cascade.winterMonths }),
    dayTypeSummer: dayTypeFromHourly(baseline, { months: cascade.summerMonths }),
  };
}
