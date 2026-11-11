// Dossier du corpus MonsieurDPE (GET /dossier/{numero} : `{ dossier, composants }`) → carte du logement.
// Module PUR, copié pour Deno par `npm run sync:tournee-engine` (_shared/dpeCorpus.js) : l'edge dpe-lien
// l'utilise pour remplir majordhome.client_dpe, le front pour afficher la carte. Testé par
// scripts/dpe-corpus.test.mjs. Spec : docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md
//
// L'objet rendu a la MÊME forme que `mapDpeRecord` (src/lib/dpeApi.js) : buildHeatLossBreakdown,
// buildCostBreakdown, buildEquipmentDrafts, toClientPatch et isDpeExpired s'y appliquent tels quels.
// Règle : un champ que le corpus ne porte pas vaut null — jamais deviné ni repris d'une autre source.

/** À incrémenter à tout changement de la correspondance : une carte enregistrée sous une version antérieure se relit. */
export const VERSION_CARTE = 1;

function texte(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function nombre(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Méthode d'application ADEME → type de logement de la fiche (maison | appartement | immeuble). */
function typeLogement(methode) {
  const m = String(methode || '').toLowerCase();
  if (m.startsWith('dpe maison')) return 'maison';
  if (m.startsWith('dpe appartement')) return 'appartement';
  if (m.startsWith('dpe immeuble')) return 'immeuble';
  return null;
}

/**
 * Étiquette dérivée des données de l'immeuble entier : besoins et déperditions décrivent l'IMMEUBLE, la surface
 * décrit le LOGEMENT (piège d'échelle du corpus, 27 % de la base). La page MonsieurDPE n'en fait pas de rapport.
 */
function estImmeubleDerive(methode) {
  return String(methode || '').toLowerCase().startsWith('dpe appartement généré');
}

/**
 * @param {{ dossier?: Record<string, unknown> | null, composants?: unknown[] } | null | undefined} data
 * @returns {object | null}
 */
export function mapCorpusDossier(data) {
  const d = data?.dossier;
  if (!d || typeof d !== 'object') return null;
  const derive = estImmeubleDerive(d.methode_application_dpe);
  const composants = Array.isArray(data.composants) ? data.composants.length : 0;
  const perte = (col) => (derive ? null : nombre(d[col]));

  return {
    dpeNumber: texte(d.identifiant_dpe),
    dpeLabel: texte(d.classe_bilan_dpe),
    gesLabel: texte(d.classe_emission_ges),
    buildingType: typeLogement(d.methode_application_dpe),
    methodeApplication: texte(d.methode_application_dpe),
    periodeConstruction: texte(d.periode_construction),
    surface: nombre(d.surface_habitable_logement),
    levels: nombre(d.nombre_niveaux),

    heatingGenerator: texte(d.type_generateur_chauffage),
    heatingEnergy: texte(d.type_energie_chauffage),
    heatingEmission: texte(d.type_emission_distribution),
    ecsGenerator: texte(d.type_generateur_ecs),
    ecsEnergy: texte(d.type_energie_ecs),
    coolingPeriod: null,
    ventilation: texte(d.type_ventilation),

    insulationEnvelope: texte(d.qualite_isolation_enveloppe),
    insulationWalls: texte(d.qualite_isolation_mur),
    insulationWindows: texte(d.qualite_isolation_menuiserie),
    insulationRoof: texte(d.qualite_isolation_plancher_haut),
    insulationFloor: texte(d.qualite_isolation_plancher_bas),

    consoPerM2: nombre(d.conso_ep_m2),
    annualCost: nombre(d.cout_5_usages),
    ubat: nombre(d.ubat),

    heatLoss: {
      total: perte('deperdition_enveloppe'),
      walls: perte('deperdition_mur'),
      floorsHigh: perte('deperdition_plancher_haut'),
      floorsLow: perte('deperdition_plancher_bas'),
      windows: perte('deperdition_baie_vitree'),
      doors: perte('deperdition_porte'),
      thermalBridges: perte('deperdition_pont_thermique'),
      airRenewal: perte('deperdition_renouvellement_air'),
    },
    costs: {
      total: nombre(d.cout_5_usages),
      heating: nombre(d.cout_chauffage),
      ecs: nombre(d.cout_ecs),
      cooling: nombre(d.cout_refroidissement),
      lighting: nombre(d.cout_eclairage),
      aux: nombre(d.cout_auxiliaires),
    },

    dpeDate: texte(d.date_etablissement),
    dpeValidUntil: texte(d.date_fin_validite),

    immeubleDerive: derive,
    // Mêmes règles que la page du rapport complet (dépôt DPE, sansDetailArchive + estImmeubleDerive).
    rapportComplet: composants > 0 && !derive,
  };
}

/**
 * Les colonnes typées de majordhome.client_dpe (filtrables pour la prospection).
 * @param {ReturnType<typeof mapCorpusDossier>} record
 */
export function colonnesFiltrables(record) {
  return {
    etiquette_dpe: record?.dpeLabel ?? null,
    etiquette_ges: record?.gesLabel ?? null,
    energie_chauffage: record?.heatingEnergy ?? null,
    generateur_chauffage: record?.heatingGenerator ?? null,
    surface: record?.surface ?? null,
    periode_construction: record?.periodeConstruction ?? null,
    date_dpe: record?.dpeDate ?? null,
    rapport_complet: record?.rapportComplet === true,
  };
}
