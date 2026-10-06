// src/apps/clim/lib/releveState.js
// État du relevé de dimensionnement clim : pièces, logement, brouillon localStorage
// `clim-draft:${userId}` (convention P1.9 — clé suffixée userId). Module PUR (pas de React).
import { DEFAULTS_CLIM } from '@/lib/clim/config.js';

export const draftKey = (userId) => `clim-draft:${userId}`;

let compteur = 0;
const idPiece = () => `p${Date.now().toString(36)}${(compteur++).toString(36)}`;

/** Pièce vierge : les champs numériques sont des chaînes (saisie), convertis par le moteur. */
export function nouvellePiece(nom = '') {
  return {
    id: idPiece(), nom, surface_m2: '', hauteur_m: '2.5', exposition: 'sud', vitrage_m2: '', protection_solaire: false,
    occupants: '2', appareils_w: '0', sous_toiture: false, longueur_liaison_m: String(DEFAULTS_CLIM.longueur_liaison_defaut_m),
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
      appareils_w: n(p.appareils_w) ?? 0, sous_toiture: !!p.sous_toiture, longueur_liaison_m: n(p.longueur_liaison_m),
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
