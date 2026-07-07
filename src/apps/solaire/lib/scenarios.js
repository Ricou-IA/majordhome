// src/apps/solaire/lib/scenarios.js
// Scénarios d'optimisation de l'autoconsommation (leviers de la « Cible »).
// Importe le moteur pur autoconsoEngine.js. Testé node --test.
// RÈGLE : le surplus n'est JAMAIS valorisé en € — import évité ou confort uniquement.
import { computeSelfConsumption, simulateBattery, hourToDate } from './autoconsoEngine.js';

const DAY_LENGTH = 24;

/**
 * Déphasage BORNÉ À LA JOURNÉE : pour chaque jour, retire `fraction` de l'énergie
 * d'un usage de ses heures et la redistribue proportionnellement au surplus PV
 * DU MÊME JOUR. Un jour sans surplus (ciel couvert / hiver) → aucun déphasage ce
 * jour-là. Physique : le ballon/VE stocke ~1 jour, on ne reporte PAS l'énergie
 * d'une nuit d'hiver vers un midi d'été. Énergie conservée jour par jour.
 * (Ancienne version annuelle-globale sur-estimait massivement — fix 2026-07-07.)
 */
export function applySolarShift(consoHourly, prodHourly, usageCurve, { fraction }) {
  const n = consoHourly.length;
  const out = consoHourly.slice();
  for (let d0 = 0; d0 < n; d0 += DAY_LENGTH) {
    const d1 = Math.min(d0 + DAY_LENGTH, n);
    let moved = 0;
    for (let h = d0; h < d1; h++) {
      out[h] = consoHourly[h] - fraction * usageCurve[h];
      moved += fraction * usageCurve[h];
    }
    let totalSurplus = 0;
    const surplus = new Array(d1 - d0);
    for (let h = d0; h < d1; h++) {
      const s = prodHourly[h] - out[h];
      surplus[h - d0] = s > 0 ? s : 0;
      totalSurplus += surplus[h - d0];
    }
    if (totalSurplus <= 0) {
      for (let h = d0; h < d1; h++) out[h] = consoHourly[h]; // pas de déphasage ce jour
      continue;
    }
    for (let h = d0; h < d1; h++) out[h] += (moved * surplus[h - d0]) / totalSurplus;
  }
  return out;
}

/**
 * Absorbe le surplus PV avec une charge de confort pilotée (ex. PAC piscine) placée
 * dans une fenêtre horaire (`hourWeights`, indexé par heure-de-journée 0-23), plafonnée
 * par `maxKwhPerHour`. Augmente la conso uniquement là où il y a du surplus (coût
 * marginal ≈ 0). Renvoie { consoHourly, absorbedKwh }. Valeur = confort, pas €.
 */
export function absorbSurplusWithLoad(consoHourly, prodHourly, { hourWeights, maxKwhPerHour = Infinity }) {
  const n = consoHourly.length;
  const newConso = consoHourly.slice();
  let absorbedKwh = 0;
  for (let h = 0; h < n; h++) {
    if (!hourWeights[h % 24]) continue;
    const surplus = prodHourly[h] - consoHourly[h];
    if (surplus <= 0) continue;
    const load = Math.min(surplus, maxKwhPerHour);
    newConso[h] += load;
    absorbedKwh += load;
  }
  return { consoHourly: newConso, absorbedKwh };
}

/** Surplus injecté (export) sommé par mois (0-11), via le calendrier du moteur. */
export function exportByMonth(prodHourly, consoHourly) {
  const out = new Array(12).fill(0);
  for (let h = 0; h < prodHourly.length; h++) {
    const exp = prodHourly[h] - consoHourly[h];
    if (exp > 0) out[hourToDate(h).month] += exp;
  }
  return out;
}

/**
 * Mois d'épaule où le surplus PV couvre le besoin de chauffe piscine → « N mois de
 * baignade en plus, alimentés par votre surplus ». shoulderMonths 0-indexés
 * (avril=3, mai=4, sept=8, oct=9). Besoin de chauffe = sous-modèle externe (v1).
 */
export function poolExtraMonths(surplusByMonth, poolHeatDemandByMonth, { shoulderMonths = [3, 4, 8, 9] } = {}) {
  const months = shoulderMonths.filter(
    (m) => poolHeatDemandByMonth[m] > 0 && surplusByMonth[m] >= poolHeatDemandByMonth[m]
  );
  return { extraMonths: months.length, months };
}

/**
 * Compose la cascade « Cible » : part du constat (baseline) et applique les `steps`
 * dans l'ordre, chaque étape cumulant sur la précédente. Types d'étape :
 *  - 'shift'   : { usageCurve, fraction } → applySolarShift
 *  - 'absorb'  : { hourWeights, maxKwhPerHour } → absorbSurplusWithLoad (expose absorbedKwh)
 *  - 'battery' : { capacityKwh, roundTripEfficiency? } → simulateBattery (à mettre EN DERNIER :
 *                ne modifie pas la conso pour les étapes suivantes).
 * Renvoie [{ key, label, autoconsoRate, selfConsumedKwh, deltaKwh, absorbedKwh? }].
 */
export function runScenarios({ baselineConso, prodHourly, steps }) {
  const results = [];
  let conso = baselineConso.slice();
  const base = computeSelfConsumption({ prodHourly, consoHourly: conso });
  results.push({ key: 'constat', label: 'Constat', autoconsoRate: base.autoconsoRate, selfConsumedKwh: base.selfConsumedKwh, deltaKwh: 0 });
  let prevSelf = base.selfConsumedKwh;

  for (const step of steps) {
    let metrics;
    let absorbedKwh;
    if (step.type === 'shift') {
      conso = applySolarShift(conso, prodHourly, step.usageCurve, { fraction: step.fraction });
      metrics = computeSelfConsumption({ prodHourly, consoHourly: conso });
    } else if (step.type === 'absorb') {
      const r = absorbSurplusWithLoad(conso, prodHourly, { hourWeights: step.hourWeights, maxKwhPerHour: step.maxKwhPerHour });
      conso = r.consoHourly;
      absorbedKwh = r.absorbedKwh;
      metrics = computeSelfConsumption({ prodHourly, consoHourly: conso });
    } else if (step.type === 'battery') {
      metrics = simulateBattery({ prodHourly, consoHourly: conso, capacityKwh: step.capacityKwh, roundTripEfficiency: step.roundTripEfficiency ?? 0.9 });
    } else {
      throw new Error(`runScenarios : type d'étape inconnu « ${step.type} »`);
    }
    const row = { key: step.key, label: step.label, autoconsoRate: metrics.autoconsoRate, selfConsumedKwh: metrics.selfConsumedKwh, deltaKwh: metrics.selfConsumedKwh - prevSelf };
    if (absorbedKwh !== undefined) row.absorbedKwh = absorbedKwh;
    results.push(row);
    prevSelf = metrics.selfConsumedKwh;
  }
  return results;
}
