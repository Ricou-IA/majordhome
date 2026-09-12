// src/lib/tournee/reglages.js
// ============================================================================
// Réglages du moteur de tournées (core.organizations.settings.tournees) et
// leurs défauts — SOURCE UNIQUE, module pur (Node, Vite, Deno). Consommé par
// tournees.service.js (navigateur) et l'edge slots-propose (copie _shared).
// ⚠️ `settings.tournees` n'est pas encore éditable dans /settings (dette
// connue) : toute nouvelle clé naît ici avec un défaut documenté.
// ============================================================================

export const REGLAGES_DEFAUT = {
  horizon_ferme_jours: 15,          // journées vides proposables jusqu'ici ; au-delà, seulement les amorcées
  horizon_ouverture_jours: 45,      // « ouvrir une nouvelle journée » : journées vides cherchées jusqu'ici
  tolerance_anniversaire_mois: 2,
  pause_minutes: 30,
  pause_fenetre: [12, 14],
  rayon_filtre_km: 25,
  fenetre_promise_minutes: 90,
  mois_creux: [11, 12, 1, 2, 3],
  // Nombre de candidats retenus après le pré-tri (score × proximité) et avant
  // le calcul de coût exact (Mapbox, trop cher sur ~300 candidats).
  max_candidats_tri: 20,
};

export function construireReglages(settings) {
  return { ...REGLAGES_DEFAUT, ...(settings?.tournees || {}) };
}
