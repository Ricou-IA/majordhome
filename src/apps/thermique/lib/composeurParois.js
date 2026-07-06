// src/apps/thermique/lib/composeurParois.js
// Logique pure du composeur de parois (étape 3 wizard Thermique) — aucun import React/Supabase.
// Le calcul du U délègue à calculeUParoi (thermalEngine, testé) ; ce module gère la recherche de
// matériaux, la conversion cm→m et le mapping famille→type Rsi/Rse.
import { calculeUParoi } from './thermalEngine.js';

// Strip des marques combinantes (accents) après NFD via la propriété Unicode \p{M} + flag u —
// robuste : pas de plage de caractères combinants LITTÉRAUX dans la source (invisibles, corruptibles).
const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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
 * Retour DOUX (pas de throw — usage UI live) : { u, erreur }. u null si vide/invalide.
 * Les couches viennent de l'UI (toujours e/lambda, jamais de résistance `r` directe) : le pré-check
 * ci-dessous couvre donc tous les cas UI. Le try/catch reste un filet défensif si `calculeUParoi`
 * venait à lever pour une raison non anticipée (évolution du moteur). */
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

/** Ajoute une entrée nommée à la bibliothèque de parois (pure, immutable). `id` fourni par le
 * caller (crypto.randomUUID côté UI — module pur sans effet de bord). Retour doux
 * { bibliotheque, erreur } : erreur si nom vide ou u non fini (bibliotheque inchangée). */
export function ajouteParoiBibliotheque(bibliotheque, entree, id) {
  const base = Array.isArray(bibliotheque) ? bibliotheque : [];
  const nom = typeof entree?.nom === 'string' ? entree.nom.trim() : '';
  if (nom === '') return { bibliotheque: base, erreur: 'Nom requis' };
  if (!Number.isFinite(entree?.u)) return { bibliotheque: base, erreur: 'U invalide' };
  const item = { id, nom, famille: entree.famille, u: entree.u, couches: entree.couches ?? [] };
  return { bibliotheque: [...base, item], erreur: null };
}

/** Retire une entrée par id (pure). id inconnu → tableau inchangé (nouvelle référence si retrait). */
export function supprimeParoiBibliotheque(bibliotheque, id) {
  const base = Array.isArray(bibliotheque) ? bibliotheque : [];
  return base.filter((p) => p.id !== id);
}
