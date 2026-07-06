// src/apps/solaire/lib/wizardState.js
// State machine du wizard (>10 useState interdit — convention qualité).
// Draft persisté localStorage `pv-draft:${userId}` (convention P1.9).
import { logger } from '@lib/logger';

export function initialWizardState(config) {
  return {
    step: 1,
    location: { lat: null, lon: null, address: '', accuracy: null, source: null }, // source: 'gps'|'adresse'
    roof: { tiltPercent: config.default_tilt_percent, orientation: 'S', surfaceM2: '' },
    conso: { monthly: Array(12).fill(''), priceKwh: config.default_price_kwh, preset: 'presence_partielle', ecsBonus: false },
    ev: { enabled: false, kmPerYear: config.ev.default_km, kwhPer100km: config.ev.default_kwh_100km, pilotedCharge: false, addCharger: false },
    pvgis: null,            // { e_m, e_y, params } — posé à l'entrée du step 3
    roofGeometry: null,     // { source, imageryQuality, segments, dominant, flux_image_path } — Google Solar
    pans: [],               // pans de toiture cartographiés : { id, polygon, footprintM2, slopeAreaM2, pitchDeg, pitchPercent, aspectPvgis, azimuthCompass, eY }
    selectedKwc: null,      // scénario sélectionné (null = recommandé)
    financing: { rate: config.default_loan_rate, years: config.default_loan_years, deposit: 0, manualCost: null },
  };
}

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'SET_STEP': return { ...state, step: action.step };
    case 'SET_LOCATION': return { ...state, location: { ...state.location, ...action.patch }, pvgis: null, roofGeometry: null, pans: [] };
    case 'SET_ROOF_GEOMETRY': return { ...state, roofGeometry: action.value };
    case 'ADD_PAN': return { ...state, pans: [...state.pans, action.pan] };
    case 'REMOVE_PAN': return { ...state, pans: state.pans.filter((p) => p.id !== action.id) };
    case 'CLEAR_PANS': return { ...state, pans: [] };
    case 'SET_ROOF': return { ...state, roof: { ...state.roof, ...action.patch }, pvgis: null };
    case 'SET_CONSO': return { ...state, conso: { ...state.conso, ...action.patch } };
    case 'SET_EV': return { ...state, ev: { ...state.ev, ...action.patch } };
    case 'SET_PVGIS': return { ...state, pvgis: action.pvgis };
    case 'SELECT_KWC': return { ...state, selectedKwc: action.kwc };
    case 'SET_FINANCING': return { ...state, financing: { ...state.financing, ...action.patch } };
    case 'LOAD': return { ...action.state };
    case 'RESET': return initialWizardState(action.config);
    default: return state;
  }
}
// NB : changer lieu/toiture invalide le cache PVGIS (pvgis: null) → re-fetch au step 3.

export const draftKey = (userId) => `pv-draft:${userId}`;

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('[solaire] draft illisible', err);
    return null;
  }
}

export function saveDraft(userId, state) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(state));
  } catch {
    // quota plein : best effort, le draft est un confort
  }
}

export function clearDraft(userId) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    // no-op
  }
}
