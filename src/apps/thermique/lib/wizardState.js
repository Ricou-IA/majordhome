// src/apps/thermique/lib/wizardState.js
// État du wizard Thermique — module PUR (aucun import React/Supabase/alias : testé via node --test,
// scripts/thermique/wizard-state.test.mjs). State machine useReducer (>10 useState interdit).
// ⚠ Le shape hors champs volatils (step/studyId/savedResults) EST le `input` jsonb persisté dans
// majordhome.thermal_studies — VERROUILLÉ, Tasks 14/15 en dépendent (toStudyInput ci-dessous).
// Brouillon localStorage `thermal-draft:${userId}` (convention P1.9 — clé suffixée userId).
import { defautSaisie } from './thermiqueConfig.js';

export function initialWizardState(config) {
  return {
    step: 1,
    studyId: null,
    contexte: {
      titre: '', clientId: null, leadId: null, commune: null, dept: null, altitude: null,
      dju: null, djuFallback: false, annee: null, typeVentilation: 'vmc-sf-auto',
      isolation: 'non-isole', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false,
    },
    dessin: {
      nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
      niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }], pieces: [], ouvertures: [],
    },
    saisie: defautSaisie(),
    compositions: {
      familles: {
        murs: { mode: 'defaut', u: null }, plancherBas: { mode: 'defaut', u: null },
        plafondToiture: { mode: 'defaut', u: null },
        fenetre: { u: 2.8 }, porteFenetre: { u: 2.8 }, porte: { u: 3.5 },
      },
      exceptions: { parois: {}, ouvertures: {} },
    },
    pac: { regime: 45, mode: null, pacId: null, points: [], scopManuel: null, prixKwh: config.prix_kwh },
    savedResults: null, // { results, engineVersion } d'une étude rouverte (R7)
  };
}

/** Pose ou retire (u == null) une exception U dans exceptions[collection][cle]. */
function avecException(state, collection, cle, u) {
  const entrees = { ...state.compositions.exceptions[collection] };
  if (u == null) delete entrees[cle];
  else entrees[cle] = { u }; // shape { u } attendu par assembleBatiment (uPour)
  return {
    ...state,
    compositions: {
      ...state.compositions,
      exceptions: { ...state.compositions.exceptions, [collection]: entrees },
    },
  };
}

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'LOAD':
      return { ...action.state };
    case 'SET_STEP':
      return { ...state, step: action.step };
    case 'PATCH_CONTEXTE':
      return { ...state, contexte: { ...state.contexte, ...action.patch } };
    case 'SET_COMMUNE':
      // Pose commune + dept + altitude + dju d'un coup (le caller a résolu le fallback DJU).
      return {
        ...state,
        contexte: {
          ...state.contexte,
          commune: action.commune,
          dept: action.commune?.dept ?? null,
          altitude: action.commune?.altitude ?? null,
          dju: action.dju,
          djuFallback: action.djuFallback,
        },
      };
    case 'SET_DESSIN':
      return { ...state, dessin: action.dessin };
    case 'SET_SAISIE':
      return { ...state, saisie: action.saisie };
    case 'PATCH_COMPOSITIONS':
      // Merge au niveau des familles (chaque valeur du patch REMPLACE la famille).
      return {
        ...state,
        compositions: {
          ...state.compositions,
          familles: { ...state.compositions.familles, ...action.patch },
        },
      };
    case 'SET_EXCEPTION_PAROI':
      return avecException(state, 'parois', action.cle, action.u);
    case 'SET_EXCEPTION_OUVERTURE':
      return avecException(state, 'ouvertures', action.ouvertureId, action.u);
    case 'PATCH_PAC':
      return { ...state, pac: { ...state.pac, ...action.patch } };
    case 'SET_STUDY_ID':
      // Après createStudy (Task 14) : mémorise l'id retourné → les saves suivants font UPDATE
      // et l'autosave brouillon localStorage se coupe (garde `state.studyId` du wizard).
      return { ...state, studyId: action.studyId };
    case 'CLEAR_SAVED_RESULTS':
      // « Recalculer avec le moteur actuel » (R7) : vide les résultats figés d'une étude
      // rouverte → l'étape 4 bascule sur le calcul live (buildEtudeModel).
      return { ...state, savedResults: null };
    case 'LOAD_STUDY': {
      // Hydrate depuis study.input par-dessus les défauts (robuste aux champs manquants —
      // études anciennes / moteur qui évolue), savedResults depuis results + engine_version (R7).
      const base = initialWizardState(action.config);
      const input = action.study?.input ?? {};
      return {
        ...base,
        step: 4,
        studyId: action.study?.id ?? null,
        contexte: { ...base.contexte, ...(input.contexte ?? {}) },
        dessin: input.dessin ?? base.dessin,
        saisie: input.saisie ?? base.saisie,
        compositions: {
          familles: { ...base.compositions.familles, ...(input.compositions?.familles ?? {}) },
          exceptions: {
            parois: { ...(input.compositions?.exceptions?.parois ?? {}) },
            ouvertures: { ...(input.compositions?.exceptions?.ouvertures ?? {}) },
          },
        },
        pac: { ...base.pac, ...(input.pac ?? {}) },
        savedResults: action.study?.results != null
          ? { results: action.study.results, engineVersion: action.study.engine_version ?? null }
          : null,
      };
    }
    case 'RESET':
      return initialWizardState(action.config);
    default:
      return state;
  }
}

/** Le `input` jsonb à persister : strip des champs volatils step/studyId/savedResults.
 * Purge aussi les exceptions U orphelines (revue globale plan 4) : la suppression d'une pièce à
 * l'étape 2 emporte ses ouvertures (dessinOps) mais pas ses exceptions — sans ce filtre, des
 * clés mortes (`${pieceId}:famille`, ouvertureId) seraient persistées dans le jsonb. */
export function toStudyInput(state) {
  // Union dessin (legacy) + saisie (paramétrique) : sinon les exceptions U par pièce d'une étude
  // paramétrique (clés `${saisie piece.id}:famille`) seraient filtrées à la sauvegarde (#2).
  const pieceIds = new Set([
    ...state.dessin.pieces.map((p) => p.id),
    ...(state.saisie?.pieces ?? []).map((p) => p.id),
  ]);
  const ouvertureIds = new Set(state.dessin.ouvertures.map((o) => o.id));
  const exceptions = state.compositions.exceptions ?? {};
  const parois = Object.fromEntries(Object.entries(exceptions.parois ?? {})
    .filter(([cle]) => pieceIds.has(cle.slice(0, cle.lastIndexOf(':')))));
  const ouvertures = Object.fromEntries(Object.entries(exceptions.ouvertures ?? {})
    .filter(([id]) => ouvertureIds.has(id)));
  return {
    contexte: state.contexte,
    dessin: state.dessin,
    saisie: state.saisie,
    compositions: { ...state.compositions, exceptions: { parois, ouvertures } },
    pac: state.pac,
  };
}

export const draftKey = (userId) => `thermal-draft:${userId}`;

export function loadDraft(userId) {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // localStorage indisponible (node) ou draft corrompu — module pur, pas de logger
  }
}

export function saveDraft(userId, state) {
  try {
    localStorage.setItem(draftKey(userId), JSON.stringify(state));
  } catch {
    // quota plein / indisponible : best effort, le draft est un confort
  }
}

export function clearDraft(userId) {
  try {
    localStorage.removeItem(draftKey(userId));
  } catch {
    // no-op
  }
}
