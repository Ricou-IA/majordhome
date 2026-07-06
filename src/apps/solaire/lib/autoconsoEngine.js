// src/apps/solaire/lib/autoconsoEngine.js
// Moteur horaire d'autoconsommation — PUR : aucun import (testable via node --test).
// Modèle : talon (forme Enedis) réconcilié sur 12 ancres mensuelles + usages
// déclarés (VE, piscine…). Autoconso instantanée = Σ min(prod, conso).
// RÈGLE ABSOLUE : le surplus n'est JAMAIS valorisé en € — on valorise l'import évité.

/** Nombre d'heures dans l'année de référence (non bissextile, 365 j). */
export const HOURS_PER_YEAR = 8760;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 365 j
const MONTH_START_HOUR = (() => {
  const starts = [];
  let acc = 0;
  for (let m = 0; m < 12; m++) { starts.push(acc); acc += DAYS_IN_MONTH[m] * 24; }
  return starts;
})();

/** Heure de l'année [0, 8759] → { month:0-11, hourOfDay:0-23, dayOfYear:0-364 }. */
export function hourToDate(h) {
  const hourOfDay = ((h % 24) + 24) % 24;
  const dayOfYear = Math.floor(h / 24);
  let month = 11;
  for (let m = 0; m < 12; m++) {
    if (h < MONTH_START_HOUR[m] + DAYS_IN_MONTH[m] * 24) { month = m; break; }
  }
  return { month, hourOfDay, dayOfYear };
}

/**
 * Autoconsommation instantanée d'une production contre une consommation, au même
 * pas de temps. selfConsumed = Σ min(prod, conso) ; export = Σ max(prod-conso, 0) ;
 * import = Σ max(conso-prod, 0). Le surplus (export) n'est jamais valorisé en €.
 */
export function computeSelfConsumption({ prodHourly, consoHourly }) {
  if (prodHourly.length !== consoHourly.length) {
    throw new Error('computeSelfConsumption : longueurs prod/conso différentes');
  }
  let selfC = 0, exp = 0, imp = 0, prod = 0, conso = 0;
  for (let i = 0; i < prodHourly.length; i++) {
    const p = prodHourly[i];
    const c = consoHourly[i];
    prod += p; conso += c;
    selfC += Math.min(p, c);
    if (p > c) exp += p - c; else imp += c - p;
  }
  return {
    prodKwh: prod,
    consoKwh: conso,
    selfConsumedKwh: selfC,
    exportedKwh: exp,
    importedKwh: imp,
    autoconsoRate: prod > 0 ? selfC / prod : 0,
    autoproductionRate: conso > 0 ? selfC / conso : 0,
  };
}

/**
 * Répartit l'énergie annuelle d'un usage pilotable (VE, piscine…) sur 8760 h
 * selon une forme déclarée : poids par heure-de-journée (24) × poids par mois (12).
 * Les poids n'ont pas à être normalisés — la fonction renormalise pour que
 * Σ = annualKwh. Aucun poids actif (Σ = 0) ou annualKwh ≤ 0 → tableau de zéros.
 */
export function distributeDeviceLoad({ annualKwh, hourOfDayWeights, monthWeights }) {
  const out = new Array(HOURS_PER_YEAR).fill(0);
  let totalWeight = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const { month, hourOfDay } = hourToDate(h);
    totalWeight += hourOfDayWeights[hourOfDay] * monthWeights[month];
  }
  if (totalWeight <= 0 || annualKwh <= 0) return out;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const { month, hourOfDay } = hourToDate(h);
    const w = hourOfDayWeights[hourOfDay] * monthWeights[month];
    out[h] = annualKwh * (w / totalWeight);
  }
  return out;
}

/**
 * Cale une forme horaire sur 12 cibles mensuelles : chaque mois est mis à
 * l'échelle pour que la somme de ses heures = monthlyTargets[m]. Un mois dont la
 * forme somme 0 mais dont la cible > 0 → répartition uniforme sur ses heures
 * (évite de perdre l'énergie du mois quand la forme est muette).
 */
export function reconcileMonthly({ hourlyShape, monthlyTargets }) {
  const out = new Array(hourlyShape.length).fill(0);
  const sumByMonth = new Array(12).fill(0);
  const countByMonth = new Array(12).fill(0);
  for (let h = 0; h < hourlyShape.length; h++) {
    const { month } = hourToDate(h);
    sumByMonth[month] += hourlyShape[h];
    countByMonth[month] += 1;
  }
  for (let h = 0; h < hourlyShape.length; h++) {
    const { month } = hourToDate(h);
    const target = monthlyTargets[month] ?? 0;
    if (sumByMonth[month] > 0) out[h] = hourlyShape[h] * (target / sumByMonth[month]);
    else if (countByMonth[month] > 0) out[h] = target / countByMonth[month];
  }
  return out;
}

/**
 * Reconstruit la courbe de charge horaire (8760) du foyer :
 * budget par usage (devices) réparti sur sa forme déclarée, puis RÉSIDU (talon) =
 * conso mensuelle − usages du mois, distribué par la forme Enedis normalisée et
 * calé sur les 12 ancres. On soustrait les usages AVANT de caler le talon pour
 * éviter le double comptage (l'archétype Enedis contient déjà un « foyer moyen »).
 * - monthlyConsoTotals[12] : conso totale du foyer par mois (les 12 ancres).
 * - baseShape[8760] : forme normalisée du talon (profil Enedis, poids relatifs).
 * - devices[] : [{ name, annualKwh, hourOfDayWeights[24], monthWeights[12] }].
 * Renvoie { hourly, byDevice, residualMonthly, warnings }.
 */
export function buildLoadCurve({ monthlyConsoTotals, baseShape, devices = [] }) {
  const warnings = [];
  const deviceCurves = devices.map((d) => ({ name: d.name, curve: distributeDeviceLoad(d) }));

  // énergie des usages par mois
  const deviceByMonth = new Array(12).fill(0);
  for (const { curve } of deviceCurves) {
    for (let h = 0; h < curve.length; h++) deviceByMonth[hourToDate(h).month] += curve[h];
  }

  // cible résiduelle mensuelle = conso totale du mois − usages du mois (bornée ≥ 0)
  const residualMonthly = monthlyConsoTotals.map((total, m) => {
    const r = total - deviceByMonth[m];
    if (r < 0) {
      warnings.push(
        `Mois ${m + 1} : usages déclarés (${deviceByMonth[m].toFixed(0)} kWh) dépassent la conso totale (${total.toFixed(0)} kWh) — talon ramené à 0.`
      );
      return 0;
    }
    return r;
  });

  const residualCurve = reconcileMonthly({ hourlyShape: baseShape, monthlyTargets: residualMonthly });

  const hourly = new Array(baseShape.length).fill(0);
  for (let h = 0; h < hourly.length; h++) {
    let v = residualCurve[h];
    for (const { curve } of deviceCurves) v += curve[h];
    hourly[h] = v;
  }

  const byDevice = Object.fromEntries(deviceCurves.map(({ name, curve }) => [name, curve]));
  return { hourly, byDevice, residualMonthly, warnings };
}

/**
 * Simulation horaire d'une batterie tampon (pas de temps = 1 h, donc kWh ≡ kW×1h).
 * À chaque heure : l'autoconso directe min(prod, conso) est toujours comptée ;
 *  - surplus (prod>conso) → charge la batterie (borné par capacité libre et maxChargeKw),
 *    le reste est exporté ;
 *  - déficit (conso>prod) → décharge (borné par SOC et maxDischargeKw), le manque
 *    résiduel est importé.
 * `roundTripEfficiency` (η) s'applique à la restitution : pour couvrir un besoin B,
 * on tire B/η de la batterie et on restitue B (limité par le SOC). Surplus jamais
 * valorisé en € : la batterie ne crée que de l'import évité.
 */
export function simulateBattery({
  prodHourly, consoHourly, capacityKwh,
  roundTripEfficiency = 0.9, maxChargeKw = Infinity, maxDischargeKw = Infinity, initialSoc = 0,
}) {
  if (prodHourly.length !== consoHourly.length) {
    throw new Error('simulateBattery : longueurs prod/conso différentes');
  }
  const eta = roundTripEfficiency;
  let soc = Math.min(initialSoc, capacityKwh);
  let direct = 0, fromBattery = 0, exported = 0, imported = 0, prod = 0, conso = 0, charged = 0, discharged = 0;

  for (let i = 0; i < prodHourly.length; i++) {
    const p = prodHourly[i];
    const c = consoHourly[i];
    prod += p; conso += c;
    direct += Math.min(p, c);
    const net = p - c;
    if (net > 0) {
      const accepted = Math.min(net, capacityKwh - soc, maxChargeKw);
      soc += accepted; charged += accepted;
      exported += net - accepted;
    } else if (net < 0) {
      const need = -net;
      const drawn = Math.min(need / eta, soc, maxDischargeKw); // énergie retirée de la batterie
      const delivered = drawn * eta;                           // énergie rendue à la maison
      soc -= drawn; discharged += drawn;
      fromBattery += delivered;
      imported += need - delivered;
    }
  }

  const selfC = direct + fromBattery;
  return {
    capacityKwh,
    prodKwh: prod,
    consoKwh: conso,
    selfConsumedDirectKwh: direct,
    selfConsumedFromBatteryKwh: fromBattery,
    selfConsumedKwh: selfC,
    exportedKwh: exported,
    importedKwh: imported,
    chargedKwh: charged,
    dischargedKwh: discharged,
    autoconsoRate: prod > 0 ? selfC / prod : 0,
    autoproductionRate: conso > 0 ? selfC / conso : 0,
  };
}

/**
 * Balaye une liste de capacités → courbe autoconso = f(capacité), et détecte le
 * « genou » (rendements décroissants) : la plus grande capacité tant que le gain
 * marginal (kWh d'autoconso récupérés par kWh de capacité ajoutée) reste ≥
 * marginalThresholdKwhPerKwh. Au-delà, chaque kWh de batterie rapporte trop peu.
 * Sert de capacité recommandée par défaut (le commercial peut choisir un autre point).
 */
export function sizeBattery({
  prodHourly, consoHourly, capacities,
  roundTripEfficiency = 0.9, marginalThresholdKwhPerKwh = 50,
}) {
  const sorted = [...capacities].sort((a, b) => a - b);
  const curve = sorted.map((cap) => {
    const r = simulateBattery({ prodHourly, consoHourly, capacityKwh: cap, roundTripEfficiency });
    return {
      capacityKwh: cap,
      autoconsoRate: r.autoconsoRate,
      autoproductionRate: r.autoproductionRate,
      selfConsumedKwh: r.selfConsumedKwh,
      importedKwh: r.importedKwh,
      exportedKwh: r.exportedKwh,
    };
  });

  let recommendedCapacityKwh = curve.length ? curve[0].capacityKwh : 0;
  for (let i = 1; i < curve.length; i++) {
    const dCap = curve[i].capacityKwh - curve[i - 1].capacityKwh;
    const dSelf = curve[i].selfConsumedKwh - curve[i - 1].selfConsumedKwh;
    const marginal = dCap > 0 ? dSelf / dCap : 0;
    if (marginal >= marginalThresholdKwhPerKwh) recommendedCapacityKwh = curve[i].capacityKwh;
    else break;
  }

  return { curve, recommendedCapacityKwh };
}
