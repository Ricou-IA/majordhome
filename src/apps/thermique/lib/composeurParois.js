// src/apps/thermique/lib/composeurParois.js
// Logique pure du composeur de parois (étape 3 wizard Thermique) — aucun import React/Supabase.
// Le calcul du U délègue à calculeUParoi (thermalEngine, testé) ; ce module gère la recherche de
// matériaux, la conversion cm→m et le mapping famille→type Rsi/Rse.
import { calculeUParoi } from './thermalEngine.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MAX_RESULTATS = 60;

/** Recherche matériaux par préfixe de nom (insensible accents/casse), filtre famille optionnel.
 * Saisie vide → tous (tronqués à MAX_RESULTATS). */
export function chercheMateriaux(materiaux, saisie, famille = null) {
  if (!Array.isArray(materiaux)) throw new Error('thermique: chercheMateriaux : materiaux doit être un tableau');
  const q = typeof saisie === 'string' ? norm(saisie.trim()) : '';
  return materiaux
    .filter((m) => (!famille || m.famille === famille) && (q === '' || norm(m.nom).startsWith(q)))
    .slice(0, MAX_RESULTATS);
}

// famille wizard → type de flux pour Rsi+Rse dans calculeUParoi (cf. en-tête thermalEngine.js).
const TYPE_FLUX = { murs: 'mur', plancherBas: 'plancher', plafondToiture: 'plafond' };

/** U d'une paroi composée de `couches` ({materiauNom, lambda, e en cm}) pour une famille wizard.
 * Retour DOUX (pas de throw — usage UI live) : { u, erreur }. u null si vide/invalide. */
export function uParoiDepuisCouches(couches, famille) {
  const type = TYPE_FLUX[famille];
  if (!type) return { u: null, erreur: `famille inconnue « ${famille} »` };
  if (!Array.isArray(couches) || couches.length === 0) return { u: null, erreur: 'Ajoutez au moins une couche' };
  const couchesM = [];
  for (const c of couches) {
    if (!Number.isFinite(c.lambda) || c.lambda <= 0 || !Number.isFinite(c.e) || c.e <= 0) {
      return { u: null, erreur: 'Chaque couche : matériau (λ > 0) et épaisseur > 0 requis' };
    }
    couchesM.push({ e: c.e / 100, lambda: c.lambda }); // cm → m
  }
  try {
    return { u: Math.round(calculeUParoi(couchesM, type) * 1000) / 1000, erreur: null };
  } catch (e) {
    return { u: null, erreur: e.message.replace(/^thermique:\s*/, '') };
  }
}
