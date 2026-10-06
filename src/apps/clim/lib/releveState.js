// src/apps/clim/lib/releveState.js
// État du relevé de dimensionnement clim : pièces, logement, brouillon localStorage
// `clim-draft:${userId}` (convention P1.9 — clé suffixée userId). Module PUR (pas de React).
import { DEFAULTS_CLIM } from '@/lib/clim/config.js';

export const draftKey = (userId) => `clim-draft:${userId}`;

/** Appareils à cocher dans une pièce : les watts cochés s'additionnent (+ un champ « Autre » libre). */
export const APPAREILS = Object.freeze([
  Object.freeze({ code: 'bureau', label: 'Bureau (ordinateur, écran)', w: 150 }),
  Object.freeze({ code: 'tv', label: 'Télévision + box', w: 300 }),
  Object.freeze({ code: 'cuisine', label: 'Cuisine ouverte', w: 500 }),
  Object.freeze({ code: 'four', label: 'Four / plaques', w: 1000 }),
  Object.freeze({ code: 'frigo', label: 'Réfrigérateur / congélateur', w: 100 }),
  Object.freeze({ code: 'seche', label: 'Sèche-linge / lave-linge', w: 400 }),
]);

/**
 * Watts d'appareils d'une pièce : somme des cases cochées + « Autre ». Un brouillon antérieur
 * (champ `appareils_w` seul) est lu comme « Autre ».
 * @param {{ appareils?: string[], appareils_autre_w?: string|number, appareils_w?: string|number }} piece
 * @returns {number}
 */
export function appareilsWatts(piece) {
  const coches = Array.isArray(piece.appareils) ? piece.appareils : [];
  const somme = APPAREILS.filter((a) => coches.includes(a.code)).reduce((s, a) => s + a.w, 0);
  const autre = piece.appareils_autre_w ?? (Array.isArray(piece.appareils) ? '' : piece.appareils_w);
  const n = Number(autre);
  return somme + (autre !== '' && autre != null && Number.isFinite(n) && n > 0 ? n : 0);
}

let compteur = 0;
const idPiece = () => `p${Date.now().toString(36)}${(compteur++).toString(36)}`;

/** Pièce vierge : les champs numériques sont des chaînes (saisie), convertis par le moteur. */
export function nouvellePiece(nom = '') {
  return {
    id: idPiece(), nom, surface_m2: '', hauteur_m: '2.5', exposition: 'sud', vitrage_m2: '', protection_solaire: false,
    occupants: '2', appareils: [], appareils_autre_w: '', sous_toiture: false, longueur_liaison_m: String(DEFAULTS_CLIM.longueur_liaison_defaut_m),
  };
}

export function releveInitial(gammeDefaut) {
  return {
    logement: { annee: '', classe_isolation: 'standard', gamme: gammeDefaut || DEFAULTS_CLIM.gamme_defaut },
    pieces: [nouvellePiece('Salon')],
  };
}

/**
 * Relevé tel que le moteur l'attend : nombres convertis, chaînes vides laissées vides
 * (le moteur refuse une surface manquante — jamais un 0 silencieux).
 */
export function releveVersMoteur(releve) {
  const n = (v) => (v === '' || v == null ? undefined : Number(v));
  return {
    logement: { classe_isolation: releve.logement.classe_isolation, gamme: releve.logement.gamme || undefined },
    pieces: releve.pieces.map((p) => ({
      nom: p.nom?.trim() || undefined, surface_m2: n(p.surface_m2), hauteur_m: n(p.hauteur_m), exposition: p.exposition,
      vitrage_m2: n(p.vitrage_m2) ?? 0, protection_solaire: !!p.protection_solaire, occupants: n(p.occupants) ?? 0,
      appareils_w: appareilsWatts(p), sous_toiture: !!p.sous_toiture, longueur_liaison_m: n(p.longueur_liaison_m),
    })),
  };
}

export function loadDraft(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(draftKey(userId));
    const d = raw ? JSON.parse(raw) : null;
    return d && d.logement && Array.isArray(d.pieces) && d.pieces.length ? d : null;
  } catch { return null; }
}

export function saveDraft(userId, releve) {
  if (!userId) return;
  try { localStorage.setItem(draftKey(userId), JSON.stringify(releve)); } catch { /* quota / navigation privée : le brouillon est un confort */ }
}

export function clearDraft(userId) {
  if (!userId) return;
  try { localStorage.removeItem(draftKey(userId)); } catch { /* idem */ }
}
