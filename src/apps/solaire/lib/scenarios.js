// src/apps/solaire/lib/scenarios.js
// Scénarios d'optimisation de l'autoconsommation (leviers de la « Cible »).
// Importe le moteur pur autoconsoEngine.js. Testé node --test.
// RÈGLE : le surplus n'est JAMAIS valorisé en € — import évité ou confort uniquement.
import { computeSelfConsumption, simulateBattery, hourToDate } from './autoconsoEngine.js';

/**
 * Déphasage : retire `fraction` de l'énergie d'un usage de ses heures actuelles et
 * la redistribue proportionnellement au SURPLUS PV disponible. Énergie conservée
 * (Σ newConso = Σ conso). Si moved ≤ Σsurplus → tout devient autoconsommé ; sinon
 * le surplus est saturé et l'excédent reste en import. Aucun surplus → conso inchangée.
 */
export function applySolarShift(consoHourly, prodHourly, usageCurve, { fraction }) {
  const n = consoHourly.length;
  const newConso = new Array(n);
  let moved = 0;
  for (let h = 0; h < n; h++) {
    newConso[h] = consoHourly[h] - fraction * usageCurve[h];
    moved += fraction * usageCurve[h];
  }
  const surplus = new Array(n);
  let totalSurplus = 0;
  for (let h = 0; h < n; h++) {
    const s = prodHourly[h] - newConso[h];
    surplus[h] = s > 0 ? s : 0;
    totalSurplus += surplus[h];
  }
  if (totalSurplus <= 0) return consoHourly.slice();
  for (let h = 0; h < n; h++) newConso[h] += (moved * surplus[h]) / totalSurplus;
  return newConso;
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
