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
