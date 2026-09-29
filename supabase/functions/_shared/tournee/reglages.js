// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/reglages.js — ne pas éditer.
// src/lib/tournee/reglages.js
// ============================================================================
// Réglages du moteur de tournées (core.organizations.settings.tournees) et
// leurs défauts — SOURCE UNIQUE, module pur (Node, Vite, Deno). Consommé par
// tournees.service.js (navigateur) et l'edge slots-propose (copie _shared).
// Éditable dans Settings → Entretiens → Tournées (TourneesTab.jsx) : toute
// nouvelle clé naît ici avec un défaut documenté, puis son champ dans l'onglet.
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
  // Les durées du barème sont celles d'interventions ISOLÉES. Chez un client à
  // plusieurs équipements, l'installation, les allers-retours au véhicule et la
  // paperasse sont mutualisés : Eric estime le gain à 10 % (2026-09-12).
  // Appliqué à la somme des barèmes dès 2 équipements ; 0 = somme brute.
  gain_multi_equipements_pct: 10,
  // Dépassement toléré de la journée de travail : finir 30 min plus tard
  // certains jours est normal — d'autres sont « fini-parti » (le technicien
  // rentre plus tôt, le budget est un plafond, pas une cible). Le budget
  // affiché reste daily_work_minutes ; le moteur refuse au-delà de
  // budget + dépassement.
  depassement_journee_minutes: 30,
  // Le retour au dépôt peut déborder l'amplitude de ce délai (« dans les faits
  // ils accélèrent pour rentrer », Eric 2026-09-30). Le dernier client, lui,
  // finit toujours dans l'amplitude.
  tolerance_retour_depot_minutes: 15,
  // Figeage automatique d'une journée PLEINE (edge tournees-figer, cron
  // horaire) : dès qu'il ne rentre plus rien, les heures deviennent
  // définitives et les clients reçoivent l'heure de passage. Décision Eric
  // 2026-09-12 : « si c'est plein depuis 10 jours, pourquoi attendre ? ».
  // `false` pour s'en tenir au bouton « Figer la journée ».
  figer_journee_pleine: true,
  // SMS « Heure de passage » au figeage (automatique ET bouton). OFF pour
  // l'instant (Eric, 2026-09-12) : les heures se figent, personne n'est
  // prévenu par SMS tant que ce réglage n'est pas activé — et il faut aussi le
  // gabarit `heure_de_passage` (Settings → SMS).
  figer_sms: false,
  // Prise de rendez-vous par le client (auto-RDV, spec 2026-09-29 § 7).
  // `enabled` gouverne le cron mensuel (mail + étiquetage + relances) ; la page
  // publique et « Copier le lien » marchent quel que soit ce réglage.
  auto_rdv: {
    enabled: false,
    capacite_cible: 4,             // contrats par journée pour dimensionner l'étiquetage
    marge_pct: 20,                 // journées étiquetées en plus du strict besoin
    seuil_reouverture_pct: 75,     // remplissage à partir duquel une journée vide de plus est étiquetée
    delai_min_jours: 2,            // pas de créneau avant J+2
    max_creneaux: 6,               // créneaux affichés au client
    relance_sms_jours: 7,
    escalade_appel_jours: 15,
    inclure_retardataires: true,   // anniversaire passé sans visite
    duree_moyenne_minutes: 90,     // pour convertir le reste d'une journée amorcée en places
  },
};

/**
 * Réglages effectifs d'une org : défauts + `settings.tournees`. Fusion superficielle,
 * sauf `auto_rdv` (objet imbriqué) fusionné clé par clé — sinon un réglage saisi
 * dans Settings effacerait tous les défauts voisins.
 * @param {object|null|undefined} settings  `core.organizations.settings`
 */
export function construireReglages(settings) {
  const t = settings?.tournees || {};
  return {
    ...REGLAGES_DEFAUT,
    ...t,
    auto_rdv: { ...REGLAGES_DEFAUT.auto_rdv, ...(t.auto_rdv || {}) },
  };
}
