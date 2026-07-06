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
