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
import { buildLoadCurve, computeSelfConsumption, simulateBattery, sizeBattery, monthlyFromHourly, dayTypeFromHourly, reconcileMonthly, distributeDeviceLoad, monthlyEnergyBreakdown } from './autoconsoEngine.js';
import { ecsDevice, veDevice, poolDevice, fromAnnualBudget, hoursMask, POOL_HOURS, CLIM_HOURS, PAC_HEATING_HOURS, PAC_HEATING_MONTH_WEIGHTS, veWeekendDeferrableFraction } from './usageProfiles.js';
import { applySolarShift, absorbSurplusWithLoad, applyVeWeekendShift, addEvChargingOnSolar } from './scenarios.js';

/** Défauts de cascade — « constatés » (fractions réalistes, à ajuster). */
export const CASCADE_DEFAULTS = {
  behaviorShiftFraction: 0.3,  // S1 comportement (déphasage ECS manuel partiel)
  pilotedShiftFraction: 0.9,   // S2 piloté ECS (asservissement ballon sur surplus)
  veWeekendShiftFraction: 0.7, // S2b VE : défaut si capacité batterie voiture non saisie
  weekdayChargeCap: 0.6,       // plafond de charge VE en semaine (le week-end complète sur solaire)
  poolMaxKwhPerHour: 3,        // PAC piscine — charge max absorbée par heure
  poolMonths: [3, 4, 5, 6, 7, 8, 9], // saison chauffe piscine (avril-oct, pas l'hiver)
  climMaxKwhPerHour: 2.5,      // clim été (confort) — charge max absorbée par heure
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
export function buildAutoconsoModel({ household, monthlyConsoTotals, baseShape, prodHourly, cascade = CASCADE_DEFAULTS, levers }) {
  // Mode « leviers » (wizard) : le CONSTAT = talon pur (identique au calculateur,
  // aucune décomposition d'usage), et les optimisations sont des toggles activés
  // avec le client. L'ECS n'est PAS dans le constat — c'est un levier proposé.
  if (levers) return buildLeversModel({ household, monthlyConsoTotals, baseShape, prodHourly, cascade, levers });

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
    const r = absorbSurplusWithLoad(consoRunning, prodHourly, { hourWeights: hoursMask(POOL_HOURS), maxKwhPerHour: cascade.poolMaxKwhPerHour, months: cascade.poolMonths });
    consoRunning = r.consoHourly;
    const scPool = sc(consoRunning);
    cascadeRows.push({ key: 'pool', label: 'PAC piscine', ...metrics(scPool), absorbedKwh: r.absorbedKwh, deltaKwh: scPool.selfConsumedKwh - prev });
    prev = scPool.selfConsumedKwh;
  }

  // S2d clim été (confort, optionnel) : le surplus finance le frais l'après-midi d'été
  if (household.clim) {
    const r = absorbSurplusWithLoad(consoRunning, prodHourly, { hourWeights: hoursMask(CLIM_HOURS), maxKwhPerHour: cascade.climMaxKwhPerHour, months: cascade.summerMonths });
    consoRunning = r.consoHourly;
    const scClim = sc(consoRunning);
    cascadeRows.push({ key: 'clim', label: 'Climatisation (confort)', ...metrics(scClim), absorbedKwh: r.absorbedKwh, deltaKwh: scClim.selfConsumedKwh - prev });
    prev = scClim.selfConsumedKwh;
  }

  // S3 batterie : dimensionnée sur la conso optimisée (post-leviers)
  const battery = sizeBattery({ prodHourly, consoHourly: consoRunning, capacities: cascade.batteryCapacities, roundTripEfficiency: cascade.batteryEfficiency });
  const battResult = simulateBattery({ prodHourly, consoHourly: consoRunning, capacityKwh: battery.recommendedCapacityKwh, roundTripEfficiency: cascade.batteryEfficiency });
  cascadeRows.push({ key: 'battery', label: `Batterie ${battery.recommendedCapacityKwh} kWh`, ...metrics(battResult), deltaKwh: battResult.selfConsumedKwh - prev });

  // Flux pour le Sankey (état optimisé, sans batterie et avec batterie recommandée)
  const fluxNoBat = computeSelfConsumption({ prodHourly, consoHourly: consoRunning });

  return {
    baseline: metrics(scBase),
    cascade: cascadeRows,
    battery,
    flux: {
      prodKwh: fluxNoBat.prodKwh, consoKwh: fluxNoBat.consoKwh,
      directKwh: fluxNoBat.selfConsumedKwh, exportedKwh: fluxNoBat.exportedKwh, importedKwh: fluxNoBat.importedKwh,
    },
    batteryFlux: {
      prodKwh: battResult.prodKwh, consoKwh: battResult.consoKwh,
      directKwh: battResult.selfConsumedDirectKwh, fromBatteryKwh: battResult.selfConsumedFromBatteryKwh,
      chargedKwh: battResult.chargedKwh, exportedKwh: battResult.exportedKwh, importedKwh: battResult.importedKwh,
    },
    byDevice,
    warnings,
    annualByMonth: monthlyFromHourly(baseline),
    dayTypeWinter: dayTypeFromHourly(baseline, { months: cascade.winterMonths }),
    dayTypeSummer: dayTypeFromHourly(baseline, { months: cascade.summerMonths }),
  };
}

/**
 * Mode « leviers » (section optimisation du WIZARD).
 * CONSTAT = talon pur (Σ min(prod, talon)) = strictement l'autoconso du calculateur
 * (`buildEtudeModel`) → cohérence garantie entre les cartes et l'optimisation.
 * Les optimisations sont des toggles proposés au client (`levers`), chacun ajoutant
 * son gain marginal :
 *  - `pilotageEcs` : routeur solaire sur le ballon (décale l'eau chaude vers midi).
 *  - `veWeekend`   : recharge VE reportée sur le week-end en journée (si VE).
 *  - `pool`/`clim` : confort financé par le surplus (absorbe le surplus, pas d'€).
 *  - `battery`     : stockage — CATÉGORIE À PART, appliqué en dernier.
 * Les courbes ECS/VE des leviers de déphasage sont BORNÉES au talon (on ne déplace
 * que ce qui est réellement consommé à ces heures → jamais de conso négative).
 */
/**
 * Traduit l'état des toggles d'optimisation du wizard (`state.optim`) en modèle
 * autoconso complet. SOURCE UNIQUE partagée par la section « Optimiser
 * l'autoconsommation » (Résultats, live) ET la génération PDF (état FIGÉ au
 * moment où le commercial valide l'étude) — garantit un rendu identique.
 *
 * `optim` = { persons, veBattery, pilotageEcs, veOn, veSimKm, pool, clim, batteryOn }.
 * `ev` = state.ev (enabled/kmPerYear) — arbitre le mode VE : 'shift' (VE déjà au
 * constat → on décale sa recharge) vs 'add' (VE en projet → on ajoute sa charge).
 */
export function buildOptimModel({ optim, ev, consoMonthly, baseShape, prodHourly }) {
  const veArg = optim.veOn
    ? (ev.enabled ? { mode: 'shift' } : { mode: 'add', kmPerYear: optim.veSimKm })
    : null;
  return buildAutoconsoModel({
    household: {
      persons: optim.persons,
      veKmPerYear: ev.enabled ? (Number(ev.kmPerYear) || 0) : 0,
      veBatteryKwh: optim.veBattery,
    },
    monthlyConsoTotals: consoMonthly,
    baseShape,
    prodHourly,
    levers: { pilotageEcs: optim.pilotageEcs, ve: veArg, pool: optim.pool, clim: optim.clim, battery: optim.batteryOn },
  });
}

function buildLeversModel({ household, monthlyConsoTotals, baseShape, prodHourly, cascade, levers }) {
  const talon = reconcileMonthly({ hourlyShape: baseShape, monthlyTargets: monthlyConsoTotals });
  const sc = (c) => computeSelfConsumption({ prodHourly, consoHourly: c });

  const scBase = sc(talon);
  const rows = [{ key: 'constat', label: "Constat (aujourd'hui)", ...metrics(scBase), deltaKwh: 0 }];
  let conso = talon;
  let prev = scBase.selfConsumedKwh;

  if (levers.pilotageEcs) {
    const ecsRaw = distributeDeviceLoad(ecsDevice({ persons: household.persons }));
    const ecsCurve = ecsRaw.map((v, h) => Math.min(v, talon[h])); // borné au talon
    conso = applySolarShift(conso, prodHourly, ecsCurve, { fraction: cascade.pilotedShiftFraction });
    const s = sc(conso);
    rows.push({ key: 'pilotage_ecs', label: 'Pilotage ECS', ...metrics(s), deltaKwh: s.selfConsumedKwh - prev });
    prev = s.selfConsumedKwh;
  }

  // Véhicule électrique — DEUX usages (précision Eric) :
  //  - mode 'shift' : VE ACTUEL, déjà dans le constat (Step 2) → on décale sa recharge
  //    vers le week-end solaire (conso inchangée).
  //  - mode 'add'   : VE FUTUR (investissement simulé) → on AJOUTE sa charge, calée sur
  //    le surplus solaire (conso augmente).
  if (levers.ve?.mode === 'shift' && household.veKmPerYear > 0) {
    const veRaw = distributeDeviceLoad(veDevice({ kmPerYear: household.veKmPerYear }));
    const veCurve = veRaw.map((v, h) => Math.min(v, conso[h])); // borné à la conso courante
    const veAnnual = veCurve.reduce((a, b) => a + b, 0);
    const frac = household.veBatteryKwh > 0
      ? veWeekendDeferrableFraction({ veAnnualKwh: veAnnual, veBatteryKwh: household.veBatteryKwh, weekdayChargeCap: cascade.weekdayChargeCap })
      : cascade.veWeekendShiftFraction;
    conso = applyVeWeekendShift(conso, prodHourly, veCurve, { fraction: frac });
    const s = sc(conso);
    rows.push({ key: 've', label: 'Recharge VE (solaire)', ...metrics(s), deltaKwh: s.selfConsumedKwh - prev });
    prev = s.selfConsumedKwh;
  } else if (levers.ve?.mode === 'add' && levers.ve.kmPerYear > 0) {
    const annualKwh = veDevice({ kmPerYear: levers.ve.kmPerYear }).annualKwh;
    conso = addEvChargingOnSolar(conso, prodHourly, { annualKwh });
    const s = sc(conso);
    rows.push({ key: 've', label: 'Véhicule électrique', ...metrics(s), deltaKwh: s.selfConsumedKwh - prev });
    prev = s.selfConsumedKwh;
  }

  if (levers.pool) {
    const r = absorbSurplusWithLoad(conso, prodHourly, { hourWeights: hoursMask(POOL_HOURS), maxKwhPerHour: cascade.poolMaxKwhPerHour, months: cascade.poolMonths });
    conso = r.consoHourly;
    const s = sc(conso);
    rows.push({ key: 'pool', label: 'Piscine', ...metrics(s), absorbedKwh: r.absorbedKwh, deltaKwh: s.selfConsumedKwh - prev });
    prev = s.selfConsumedKwh;
  }

  if (levers.clim) {
    const r = absorbSurplusWithLoad(conso, prodHourly, { hourWeights: hoursMask(CLIM_HOURS), maxKwhPerHour: cascade.climMaxKwhPerHour, months: cascade.summerMonths });
    conso = r.consoHourly;
    const s = sc(conso);
    rows.push({ key: 'clim', label: 'Climatisation', ...metrics(s), absorbedKwh: r.absorbedKwh, deltaKwh: s.selfConsumedKwh - prev });
    prev = s.selfConsumedKwh;
  }

  let battery = { curve: [], recommendedCapacityKwh: 0 };
  let battResult = null;
  if (levers.battery) {
    battery = sizeBattery({ prodHourly, consoHourly: conso, capacities: cascade.batteryCapacities, roundTripEfficiency: cascade.batteryEfficiency });
    battResult = simulateBattery({ prodHourly, consoHourly: conso, capacityKwh: battery.recommendedCapacityKwh, roundTripEfficiency: cascade.batteryEfficiency });
    rows.push({ key: 'battery', label: `Batterie ${battery.recommendedCapacityKwh} kWh`, ...metrics(battResult), deltaKwh: battResult.selfConsumedKwh - prev });
  }

  const fluxNoBat = sc(conso);
  const batteryCapacity = levers.battery ? battery.recommendedCapacityKwh : 0;
  // Graphe mensuel « qui bouge » : ventilation de l'état optimisé COURANT (leviers +
  // batterie), pour la démo client (les barres autoconso montent quand on toggle).
  const monthly = monthlyEnergyBreakdown({ prodHourly, consoHourly: conso, capacityKwh: batteryCapacity, roundTripEfficiency: cascade.batteryEfficiency });
  return {
    baseline: metrics(scBase),
    cascade: rows,
    battery,
    flux: {
      prodKwh: fluxNoBat.prodKwh, consoKwh: fluxNoBat.consoKwh,
      directKwh: fluxNoBat.selfConsumedKwh, exportedKwh: fluxNoBat.exportedKwh, importedKwh: fluxNoBat.importedKwh,
    },
    batteryFlux: battResult ? {
      prodKwh: battResult.prodKwh, consoKwh: battResult.consoKwh,
      directKwh: battResult.selfConsumedDirectKwh, fromBatteryKwh: battResult.selfConsumedFromBatteryKwh,
      chargedKwh: battResult.chargedKwh, exportedKwh: battResult.exportedKwh, importedKwh: battResult.importedKwh,
    } : null,
    monthly,
    // Courbe de charge journée-type (24 h) : production, conso ACTUELLE (talon) et
    // conso OPTIMISÉE — le client voit sa conso glisser sous la cloche solaire.
    dayCurves: {
      prod: dayTypeFromHourly(prodHourly),
      consoBaseline: dayTypeFromHourly(talon),
      conso: dayTypeFromHourly(conso),
    },
    byDevice: {},
    warnings: [],
    annualByMonth: monthlyFromHourly(talon),
    dayTypeWinter: dayTypeFromHourly(talon, { months: cascade.winterMonths }),
    dayTypeSummer: dayTypeFromHourly(talon, { months: cascade.summerMonths }),
  };
}
