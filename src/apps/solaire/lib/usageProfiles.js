// src/apps/solaire/lib/usageProfiles.js
// Bibliothèque de sous-profils d'usage — PUR : aucun import.
// Produit des `device` { name, annualKwh, hourOfDayWeights[24], monthWeights[12] }
// consommés par distributeDeviceLoad (autoconsoEngine.js).
// Défauts validés Eric 2026-07-07 — spec :
//   docs/superpowers/specs/2026-07-07-solaire-sous-profils-usages-design.md
// RÈGLE : le surplus n'est JAMAIS valorisé en €.
// NB : monthWeights porte l'ÉNERGIE/JOUR du mois (pas /mois) → distributeDeviceLoad
//      reproduit la répartition mensuelle exacte (× jours du mois, cf. tests).

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Tableau de 24 poids horaires : 1 sur les heures listées, 0 sinon. */
export function hoursMask(hours) {
  const w = new Array(24).fill(0);
  for (const h of hours) w[((h % 24) + 24) % 24] = 1;
  return w;
}

export const ECS_NIGHT_HOURS = [22, 23, 0, 1, 2, 3, 4, 5];
export const ECS_SOLAR_HOURS = [11, 12, 13, 14, 15];
export const VE_NIGHT_HOURS = [23, 0, 1, 2, 3, 4, 5];
export const POOL_HOURS = [11, 12, 13, 14, 15, 16, 17];
export const PAC_HEATING_HOURS = [6, 7, 8, 9, 18, 19, 20, 21, 22];

/** Eau froide réseau par mois (°C), saisonnière. Défaut FR (validé Eric). */
export const COLD_WATER_TEMP_BY_MONTH = [10, 10, 11, 13, 15, 17, 18, 18, 17, 15, 12, 10];

/**
 * Device ECS dérivé du nombre de personnes (physique de chauffe de l'eau) :
 * E_jour(m) = persons × litersPerPersonPerDay × (tankTempC − coldWaterTempByMonth[m])
 *             × 1.163 / 1000 / tankEfficiency  (kWh/jour ; 1.163 = chaleur massique eau).
 * monthWeights[m] = E_jour(m). annualKwh = Σ E_jour(m) × jours(m).
 * mode 'night' = ballon nuit HC (baseline) ; 'solar' = cible délestage midi.
 */
export function ecsDevice({
  persons,
  litersPerPersonPerDay = 40,
  tankTempC = 55,
  coldWaterTempByMonth = COLD_WATER_TEMP_BY_MONTH,
  tankEfficiency = 0.9,
  mode = 'night',
}) {
  const dailyByMonth = coldWaterTempByMonth.map(
    (cold) => (persons * litersPerPersonPerDay * (tankTempC - cold) * 1.163) / 1000 / tankEfficiency
  );
  const annualKwh = dailyByMonth.reduce((sum, e, m) => sum + e * DAYS_IN_MONTH[m], 0);
  return {
    name: 'ecs',
    annualKwh,
    hourOfDayWeights: hoursMask(mode === 'solar' ? ECS_SOLAR_HOURS : ECS_NIGHT_HOURS),
    monthWeights: dailyByMonth,
  };
}

/** Device VE : énergie annuelle depuis le kilométrage, charge nuit par défaut. */
export function veDevice({ kmPerYear, kwhPer100km = 18, homeChargeShare = 0.9 }) {
  const annualKwh = ((kmPerYear * kwhPer100km) / 100) * homeChargeShare;
  return {
    name: 've',
    annualKwh,
    hourOfDayWeights: hoursMask(VE_NIGHT_HOURS),
    monthWeights: new Array(12).fill(1),
  };
}

/** Saison piscine par défaut (poids relatifs/jour, avril→oct, pic été). Validé Eric. */
export const POOL_SEASON_WEIGHTS = [0, 0, 0, 0.2, 0.5, 1, 1, 1, 0.6, 0.2, 0, 0];

/**
 * Device piscine : pompe de filtration, fenêtre midi, saisonnier.
 * monthWeights[m] = pumpKw × hoursPerDay × seasonWeights[m] (énergie/jour) ;
 * annualKwh = Σ (pumpKw × hoursPerDay × seasonWeights[m]) × jours(m).
 */
export function poolDevice({ pumpKw = 0.8, hoursPerDay = 8, seasonWeights = POOL_SEASON_WEIGHTS }) {
  const dailyByMonth = seasonWeights.map((s) => pumpKw * hoursPerDay * s);
  const annualKwh = dailyByMonth.reduce((sum, e, m) => sum + e * DAYS_IN_MONTH[m], 0);
  return {
    name: 'piscine',
    annualKwh,
    hourOfDayWeights: hoursMask(POOL_HOURS),
    monthWeights: dailyByMonth,
  };
}

/** Répartition mensuelle chauffage PAC par défaut (∝ degrés-jours). Validé Eric. */
export const PAC_HEATING_MONTH_WEIGHTS = [1, 0.9, 0.7, 0.4, 0.1, 0, 0, 0, 0.1, 0.4, 0.7, 1];

/**
 * Device générique depuis un budget annuel saisi (PAC chauffage v1, autres usages).
 * L'énergie annuelle est imposée telle quelle ; forme journalière + mensuelle fournies.
 * Copies défensives des tableaux (l'appelant peut passer une constante partagée).
 */
export function fromAnnualBudget({ name, annualKwh, hourOfDayWeights, monthWeights }) {
  return { name, annualKwh, hourOfDayWeights: [...hourOfDayWeights], monthWeights: [...monthWeights] };
}

/**
 * Part de l'énergie VE reportable sur la recharge week-end solaire, dérivée de la
 * capacité batterie voiture (saisie au formulaire) et du besoin hebdo.
 * Règle : en semaine on charge au plus à `weekdayChargeCap` (60 %) de la batterie ;
 * le week-end on remonte à 100 % sur le surplus → le week-end couvre au plus
 * (1 − cap) × capacité par semaine. fraction = min(1, (1−cap) × batterie / besoin_hebdo).
 * Besoin ou capacité nuls → 0.
 */
export function veWeekendDeferrableFraction({ veAnnualKwh, veBatteryKwh, weekdayChargeCap = 0.6 }) {
  const weekly = veAnnualKwh / 52;
  if (weekly <= 0 || veBatteryKwh <= 0) return 0;
  return Math.min(1, ((1 - weekdayChargeCap) * veBatteryKwh) / weekly);
}
