// src/apps/solaire/lib/pvConfig.js
// Défauts du calculateur PV. Surchargés par core.organizations.settings.pv
// (édités via /settings/solaire). PUR : aucun import React/Supabase.

export const PV_DEFAULTS = {
  default_price_kwh: 0.20,      // €/kWh TTC — ⚠️ à ajuster au TRV en vigueur
  inflation_rate: 0.03,
  degradation_rate: 0.005,
  horizon_years: 25,
  system_loss: 14,              // % pertes système (défaut PVGIS)
  panel_power_wc: 500,
  panel_area_m2: 2.26,
  default_tilt_percent: 18,
  autoconso_threshold: 0.85,
  max_power_kwc: 9,             // plafond offre résidentielle (régime réglementaire ≤ 9 kWc)
  // Recalibrage prudence 2026-06-11 (Eric) : les valeurs initiales de la spec
  // (0,70/0,55/0,45, bonus +0,10, plafond 0,85) empilées promettaient 75 %
  // d'autoconso — jamais constaté. Base ~50 %, bonus halvés, plafond 0,75.
  // Hypothèses déclaratives À CALIBRER avec les relevés réels (édit. admin).
  simultaneity: {
    presence_journee: 0.60,
    presence_partielle: 0.50,
    absent_journee: 0.40,
    bonus_ecs: 0.05,
    bonus_ve: 0.05,
    cap: 0.75,
  },
  cost_grid: [],                // [{ kwc, prix_ttc }] — 1 à 9 kWc, rempli par l'admin
  tech_docs: [],                // bibliothèque technique : [{ id, label, kind: 'panneau'|'borne'|'onduleur'|'autre', path, attach }]
  default_loan_rate: 0.045,
  default_loan_years: 12,
  vat_rate: 0.055,              // informatif (grille en TTC)
  ev: {
    charger_price: null,        // € TTC borne posée — à remplir par l'admin
    home_charge_share: 0.95,
    default_km: 20000,
    default_kwh_100km: 20,
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Config effective = settings.pv (org) mergé en profondeur sur PV_DEFAULTS. */
export function buildPvConfig(settings) {
  return deepMerge(PV_DEFAULTS, settings?.pv);
}
