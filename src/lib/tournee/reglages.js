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
  // Souplesse (spec 2026-09-12 « fenêtres d'abord, heures ensuite ») :
  // tolérance par défaut d'un RDV sans souplesse renseignée (appointments.time_flex_minutes NULL).
  souplesse_defaut_minutes: 30,
  // En dessous, le temps restant après une insertion est du temps de technicien
  // perdu (plus petite visite + un trajet) : pénalisé dans le classement.
  reste_utile_min_minutes: 75,
  // Fenêtres « demi-journée » (time_flex_minutes = 240), en heures.
  demi_journee: { matin: [8, 12], apres_midi: [13, 18] },
  // Trajet maximum entre DEUX CLIENTS pour qu'une insertion soit raisonnable
  // (décision Eric 2026-09-12 : « tout rentre » ≠ « c'est raisonnable »). Les
  // trajets depuis/vers le dépôt en sont exclus : un client isolé impose un
  // aller dédié — c'est précisément le cas « ouvrir une nouvelle journée ».
  trajet_max_entre_clients_minutes: 45,
};

export function construireReglages(settings) {
  return { ...REGLAGES_DEFAUT, ...(settings?.tournees || {}) };
}
