// src/lib/tournee/matrice.js
// ============================================================================
// Assemblage de la matrice de trajets. Module PUR (le fetch Mapbox vit dans
// trajets.service.js). Testé : node --test scripts/tournee/trajets-matrice.test.mjs
// ============================================================================

import { haversineKm } from './geo.js';

const FACTEUR_ROUTE = 1.4;    // le réseau routier rallonge le vol d'oiseau
const VITESSE_KMH = 50;       // moyenne rurale Tarn, trajets courts inclus
const DEFAUT_PAIRE_INCONNUE = 60;

/**
 * @param {Map<string, number>} paires clés "from|to" → minutes
 * @param {object} [options]
 * @param {number} [options.defautMinutes] coût d'une paire absente. Volontairement
 *   élevé : retourner 0 ferait croire au moteur que le trajet est gratuit et
 *   produirait des tournées impossibles — un échec silencieux.
 * @param {Function} [options.repli] `(fromKey, toKey) => minutes` consulté AVANT
 *   de tomber sur `defautMinutes`. Sert à combler les paires que Mapbox n'a pas
 *   été appelé à calculer — typiquement candidat↔candidat, que
 *   `proposerPourJournee` ne demande jamais (il n'évalue qu'un candidat à la
 *   fois). Sans lui, l'aperçu d'une sélection multiple retombait sur 60 min
 *   forfaitaires, ou bien devait basculer TOUTE la journée en vol d'oiseau — et
 *   affichait alors une heure différente de celle de la liste pour le MÊME
 *   client. Deux chiffres contradictoires côte à côte sur un écran de décision.
 */
export function construireMatrice(paires, { defautMinutes = DEFAUT_PAIRE_INCONNUE, repli } = {}) {
  return (fromKey, toKey) => {
    if (fromKey === toKey) return 0;
    const v = paires.get(`${fromKey}|${toKey}`);
    if (v != null) return v;
    if (repli) {
      const r = repli(fromKey, toKey);
      if (Number.isFinite(r)) return r;
    }
    return defautMinutes;
  };
}

/** Repli quand Mapbox est indisponible ou hors quota. */
export function estimerParVolDOiseau(km) {
  return Math.round((km * FACTEUR_ROUTE) / VITESSE_KMH * 60);
}

/**
 * Trajet 100% local (aucun réseau) : parse deux clés "lat,lng" (cf.
 * `cleCoord`, geo.js) et estime en vol d'oiseau. Sert au recalcul instantané
 * pendant une sélection multi-candidats (RemplirJourneePanel) : la matrice
 * Mapbox de `proposerPourJournee` ne compare JAMAIS deux candidats entre eux
 * (seul le noyau dépôt+arrêts existants est comparé à chaque candidat), donc
 * dès que ≥2 candidats sont sélectionnés ensemble, aucune distance réelle
 * n'existe pour cette paire — ce module fournit le seul `trajet(from,to)`
 * disponible sans appel réseau. Ne jamais utiliser pour les horaires POSÉS en
 * base : cf. `trajetsService.chargerMatrice` avec les candidats retenus dans
 * le `noyau`, seule source d'horaires réels au moment de la pose.
 *
 * @param {string|null} fromKey
 * @param {string|null} toKey
 * @returns {number} minutes
 */
export function trajetLocal(fromKey, toKey) {
  // Le garde-fou clé manquante passe AVANT l'égalité : `null === null` est
  // vrai en JS, ce qui ferait renvoyer 0 (« même point ») pour deux points
  // en réalité INCONNUS — un trajet gratuit entre deux emplacements non
  // localisés serait un échec silencieux, pas une coïncidence.
  if (!fromKey || !toKey) return DEFAUT_PAIRE_INCONNUE;
  if (fromKey === toKey) return 0;
  const [latA, lngA] = fromKey.split(',').map(Number);
  const [latB, lngB] = toKey.split(',').map(Number);
  return estimerParVolDOiseau(haversineKm({ lat: latA, lng: lngA }, { lat: latB, lng: lngB }));
}
