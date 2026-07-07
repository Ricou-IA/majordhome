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
//
// ⚠️ LIMITATION CONNUE (WIP 2026-07-07) : `applySolarShift` (scenarios.js) redistribue
// l'énergie déplacée sur le surplus ANNUEL → il « déplace » de l'ECS d'une nuit d'hiver
// vers un midi d'été (physiquement impossible : le ballon stocke ~1 jour). Les % de la
// cascade sont donc SUR-ESTIMÉS (déphasage piloté ~+50% observé vs +5-10% réaliste). Fix
// requis avant mise en prod : déphasage BORNÉ À LA JOURNÉE. La plomberie ci-dessous est
// correcte ; seul le primitive de déphasage doit être rendu journalier.
import { buildLoadCurve, computeSelfConsumption, simulateBattery, sizeBattery, monthlyFromHourly, dayTypeFromHourly } from './autoconsoEngine.js';
import { ecsDevice, veDevice, poolDevice, fromAnnualBudget, hoursMask, POOL_HOURS, PAC_HEATING_HOURS, PAC_HEATING_MONTH_WEIGHTS } from './usageProfiles.js';
import { applySolarShift, absorbSurplusWithLoad } from './scenarios.js';

/** Défauts de cascade — « constatés » (fractions réalistes, à ajuster). */
export const CASCADE_DEFAULTS = {
  behaviorShiftFraction: 0.3, // S1 comportement (déphasage ECS manuel partiel)
  pilotedShiftFraction: 0.9,  // S2 piloté (asservissement ECS + VE)
  poolMaxKwhPerHour: 3,       // PAC piscine — charge max absorbée par heure
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

  // S1 comportement : déphasage ECS partiel depuis la baseline
  const consoBehavior = applySolarShift(baseline, prodHourly, ecsCurve, { fraction: cascade.behaviorShiftFraction });
  // S2 piloté : déphasage ECS (+ VE) fort depuis la baseline
  let consoPiloted = applySolarShift(baseline, prodHourly, ecsCurve, { fraction: cascade.pilotedShiftFraction });
  if (veCurve) consoPiloted = applySolarShift(consoPiloted, prodHourly, veCurve, { fraction: cascade.pilotedShiftFraction });

  // S2bis PAC piscine : absorbe le surplus au-dessus du tier piloté
  let consoAfterPool = consoPiloted;
  let poolAbsorbedKwh = 0;
  if (household.pool) {
    const r = absorbSurplusWithLoad(consoPiloted, prodHourly, { hourWeights: hoursMask(POOL_HOURS), maxKwhPerHour: cascade.poolMaxKwhPerHour });
    consoAfterPool = r.consoHourly;
    poolAbsorbedKwh = r.absorbedKwh;
  }

  // S3 batterie : dimensionnée sur la conso post-piloté (+ piscine)
  const battery = sizeBattery({ prodHourly, consoHourly: consoAfterPool, capacities: cascade.batteryCapacities, roundTripEfficiency: cascade.batteryEfficiency });
  const battResult = simulateBattery({ prodHourly, consoHourly: consoAfterPool, capacityKwh: battery.recommendedCapacityKwh, roundTripEfficiency: cascade.batteryEfficiency });

  // Cascade (gains marginaux)
  const scBase = computeSelfConsumption({ prodHourly, consoHourly: baseline });
  const scBeh = computeSelfConsumption({ prodHourly, consoHourly: consoBehavior });
  const scPil = computeSelfConsumption({ prodHourly, consoHourly: consoPiloted });
  const scPool = computeSelfConsumption({ prodHourly, consoHourly: consoAfterPool });

  const cascadeRows = [
    { key: 'constat', label: 'Constat (sans changement)', ...metrics(scBase), deltaKwh: 0 },
    { key: 'behavior', label: 'Changement de comportement', ...metrics(scBeh), deltaKwh: scBeh.selfConsumedKwh - scBase.selfConsumedKwh },
    { key: 'piloted', label: `Déphasage piloté (ECS${veCurve ? ' + VE' : ''})`, ...metrics(scPil), deltaKwh: scPil.selfConsumedKwh - scBeh.selfConsumedKwh },
  ];
  if (household.pool) {
    cascadeRows.push({ key: 'pool', label: 'PAC piscine', ...metrics(scPool), absorbedKwh: poolAbsorbedKwh, deltaKwh: scPool.selfConsumedKwh - scPil.selfConsumedKwh });
  }
  const prevBeforeBattery = household.pool ? scPool.selfConsumedKwh : scPil.selfConsumedKwh;
  cascadeRows.push({
    key: 'battery',
    label: `Batterie ${battery.recommendedCapacityKwh} kWh`,
    ...metrics(battResult),
    deltaKwh: battResult.selfConsumedKwh - prevBeforeBattery,
  });

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
