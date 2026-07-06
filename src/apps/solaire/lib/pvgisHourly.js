// src/apps/solaire/lib/pvgisHourly.js
// Transformations PURES de la réponse PVGIS seriescalc → prodHourly pour le moteur
// d'autoconsommation. Aucun import (testable via node --test).
// Réf. spike : docs/superpowers/spikes/2026-07-07-enedis-pvgis-hourly.md
//   outputs.hourly[] : { time:"YYYYMMDD:HHMM", P:<watts pour 1 kWc> }.
//   Années bissextiles → 8784 pas (366 j) ≠ 8760 attendu par le moteur.

/**
 * Convertit la série horaire PVGIS (P en W pour peakpower=1 kWc) en production
 * horaire kWh pour `powerKwc` kWc : prod = P × powerKwc / 1000 (linéarité kWc,
 * 1 seul appel PVGIS/simulation — cf. edge pvgis-proxy). Ne réaligne PAS la
 * longueur (voir alignTo8760). Renvoie { prodHourly, year }.
 */
export function parsePvgisHourly(outputsHourly, powerKwc) {
  if (!Array.isArray(outputsHourly) || outputsHourly.length === 0) {
    throw new Error('parsePvgisHourly : outputsHourly vide ou invalide');
  }
  const year = Number(String(outputsHourly[0].time).slice(0, 4));
  const prodHourly = outputsHourly.map((row) => (row.P * powerKwc) / 1000);
  return { prodHourly, year };
}

/** Heure de début du 29 février dans une année bissextile : 31 (janv.) + 28 (févr.) = 59 j. */
const FEB29_START_HOUR = 59 * 24; // 1416

/**
 * Aligne une série horaire sur 8760 pas (calendrier 365 j du moteur).
 * - 8760 → copie inchangée.
 * - 8784 (année bissextile) → retire les 24 h du 29 février ([1416, 1439]).
 * - toute autre longueur → erreur (donnée inattendue, échec explicite).
 * Générique : s'applique aussi bien à la production PVGIS qu'à un talon Enedis.
 */
export function alignTo8760(hourly) {
  if (hourly.length === 8760) return hourly.slice();
  if (hourly.length === 8784) {
    return [...hourly.slice(0, FEB29_START_HOUR), ...hourly.slice(FEB29_START_HOUR + 24)];
  }
  throw new Error(`alignTo8760 : longueur inattendue ${hourly.length} (attendu 8760 ou 8784)`);
}

/**
 * Chaîne complète PVGIS → production horaire prête pour le moteur :
 * parse (W→kWh × kWc) puis alignement 8760. Renvoie { prodHourly, year }
 * avec prodHourly.length === 8760.
 */
export function pvgisToProdHourly(outputsHourly, powerKwc) {
  const { prodHourly, year } = parsePvgisHourly(outputsHourly, powerKwc);
  return { prodHourly: alignTo8760(prodHourly), year };
}
