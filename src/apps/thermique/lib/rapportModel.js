// src/apps/thermique/lib/rapportModel.js
// Modèle de VUE du rapport PDF — module PUR (aucun import React/Supabase/alias, testé via
// node --test scripts/thermique/rapport-model.test.mjs).
//
// Ne calcule AUCUNE physique : consomme le modèle de buildEtudeModel (SOURCE DE CALCUL UNIQUE
// écran ↔ PDF, spec §8) et le met en forme pour les pages react-pdf — postes ordonnés, lignes par
// pièce avec échelle de couleur, courbe de bivalence échantillonnée, hypothèses retenues.
// Corollaire : un chiffre du PDF absent de l'écran est un bug de CE module, jamais du moteur.
import { courbeCharge, pThAt, pThManuelle, pointsManuelsValides } from './heatPumpEngine.js';
import { resolvePeriode } from './refDataResolvers.js';
import { resoudUFamille } from './assembleBatimentParametrique.js';
import { PLAGES_VRAISEMBLANCE } from './thermiqueConfig.js';

/** Ordre et libellés FR des postes de bilan.parPoste (clés du moteur, cf. calculeBatiment).
 * Source unique écran (Step4Resultats) ↔ PDF. */
export const POSTES_LABELS = [
  ['murs', 'Murs'],
  ['menuiseries', 'Menuiseries'],
  ['plancherBas', 'Plancher bas'],
  ['plafondToiture', 'Plafond & toiture'],
  ['pontsThermiques', 'Ponts thermiques'],
  ['ventilation', 'Ventilation'],
  ['relance', 'Relance'],
];

const BLEU = [59, 130, 246]; // #3b82f6 — pièce la moins déperditive (W/m²)
const AMBRE = [245, 158, 11]; // #f59e0b — pièce la plus déperditive (W/m²)

/** Interpolation linéaire bleu → ambre, t ∈ [0, 1] (clampé). Palette deutan R12 : JAMAIS rouge/vert.
 * Retour en hexadécimal — react-pdf et CSS l'acceptent tous les deux (rgb() n'est pas garanti côté
 * react-pdf), ce qui permet la MÊME fonction à l'écran (ResultatsPiecesGrid) et dans le PDF. */
export function couleurRatio(t) {
  const borne = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5));
  return `#${BLEU.map((v, i) => Math.round(v + (AMBRE[i] - v) * borne).toString(16).padStart(2, '0')).join('')}`;
}

/** Postes non nuls, ordonnés, avec la part du total et la largeur relative (barres du PDF).
 * `largeur` ∈ ]0, 1] est normalisée sur le poste le plus lourd (même lecture qu'à l'écran). */
export function postesRapport(bilan) {
  const lignes = POSTES_LABELS
    .map(([cle, label]) => ({ cle, label, valeur: bilan?.parPoste?.[cle] ?? 0 }))
    .filter((p) => p.valeur > 0);
  const max = Math.max(...lignes.map((p) => p.valeur), 1);
  const somme = lignes.reduce((s, p) => s + p.valeur, 0);
  return lignes.map((p) => ({ ...p, part: somme > 0 ? p.valeur / somme : 0, largeur: p.valeur / max }));
}

/** Lignes par pièce + bornes de l'échelle de couleur + totaux de pied de tableau.
 * `emetteur` retombe sur `total` quand le foisonnement n'a pas été posé (bilan figé ancien). */
export function piecesRapport(bilan) {
  const pieces = bilan?.pieces ?? [];
  const ratios = pieces.map((p) => (p.surface > 0 ? p.total / p.surface : 0));
  const ratioMin = ratios.length ? Math.min(...ratios) : 0;
  const ratioMax = ratios.length ? Math.max(...ratios) : 0;
  const lignes = pieces.map((p, i) => {
    const t = ratioMax > ratioMin ? (ratios[i] - ratioMin) / (ratioMax - ratioMin) : 0.5;
    return {
      id: p.id,
      nom: p.nom,
      surface: p.surface,
      transmission: p.transmission,
      ventilation: p.ventilation,
      relance: p.relance ?? 0,
      total: p.total,
      emetteur: p.puissanceEmetteur ?? p.total,
      ratio: ratios[i],
      couleur: couleurRatio(t),
    };
  });
  return {
    lignes,
    ratioMin,
    ratioMax,
    // Colonne Relance seulement si la relance participe au bilan (fRH effectif > 0) — idem écran.
    avecRelance: (bilan?.parPoste?.relance ?? 0) > 0,
    totaux: {
      surface: lignes.reduce((s, p) => s + p.surface, 0),
      total: bilan?.total ?? 0,
      emetteur: lignes.reduce((s, p) => s + p.emetteur, 0),
    },
  };
}

/**
 * Courbe « besoin vs puissance PAC » échantillonnée au pas de 1 K sur [θe − 2 ; θnc] — mêmes
 * fonctions moteur que le graphe Recharts de l'écran (pas de duplication d'interpolation).
 * @param {object} machine PAC du catalogue hplib (null si mode manuel ou catalogue non chargé)
 * @returns {Array<{theta, besoin, pac}>|null} null si la machine n'est pas résolvable (le PDF
 *   affiche alors les seuls indicateurs de bivalence — il ne bloque jamais).
 */
export function courbeBivalence({ bilan, thetaE, thetaNC, pac, machine }) {
  if (!bilan || !Number.isFinite(thetaE) || !Number.isFinite(thetaNC) || thetaNC <= thetaE) return null;
  const manuels = pac?.mode === 'manuelle' ? pointsManuelsValides(pac.points) : null;
  const enManuel = manuels != null && manuels.length >= 2;
  if (!enManuel && !machine) return null;
  const charge = courbeCharge({ phiTotal: bilan.total, thetaBase: thetaE, thetaNC });
  const points = [];
  for (let theta = Math.round(thetaE) - 2; theta <= thetaNC; theta += 1) {
    // pThAt lève hors tExt [−30, 45] → clamp (θe − 2 reste largement dedans en métropole).
    const pth = enManuel
      ? pThManuelle(manuels, theta)
      : pThAt(machine, Math.min(45, Math.max(-30, theta)), pac.regime);
    points.push({ theta, besoin: charge(theta), pac: pth });
  }
  return points;
}

const ISOLATION_LABELS = {
  'non-isole': 'Non isolé',
  iti: 'ITI — isolation par l’intérieur',
  ite: 'ITE — isolation par l’extérieur',
};

const PLANCHER_BAS_LABELS = {
  'terre-plein': 'Terre-plein',
  'vide-sanitaire': 'Vide sanitaire',
  'sous-sol': 'Sous-sol',
};

const TOITURE_LABELS = { comble: 'Combles perdus', rampant: 'Rampants isolés' };

// Familles de parois opaques (U par défaut de période) et menuiseries (U saisi) — l'ordre est
// celui du tableau « U retenus » du PDF.
const FAMILLES_OPAQUES = [
  ['murs', 'Murs'],
  ['plancherBas', 'Plancher bas'],
  ['plafondToiture', 'Plafond & toiture'],
];
const FAMILLES_MENUISERIES = [
  ['fenetre', 'Fenêtres'],
  ['porteFenetre', 'Portes-fenêtres'],
  ['porte', 'Portes'],
];

/**
 * Hypothèses de calcul retenues — la page « transparence » du rapport (spec §8 : U retenus,
 * ventilation, θe, forfaits). Aucune valeur n'est recalculée : les U passent par resoudUFamille,
 * exactement comme l'assembleur.
 * @param {{ contexte, saisie, compositions, foisonnement }} etude état wizard (= input persisté)
 * @param {{ config, data, thetaE }} env config org + data JSON + θe effectivement retenu
 */
export function hypothesesRapport(etude, { config, data, thetaE }) {
  const { contexte, compositions } = etude;
  // plancherBasType/toitureType vivent dans `saisie` (mode paramétrique) mais dans `dessin` sur les
  // études legacy — même précédence que l'assembleur choisi par buildEtudeModel.
  const saisie = etude?.saisie?.modeSaisie === 'parametrique' ? etude.saisie : (etude?.dessin ?? etude?.saisie);
  const annee = contexte?.annee ?? null;
  const periode = resolvePeriode(annee);
  const systeme = data?.ventilation?.systemes?.find((s) => s.id === contexte?.typeVentilation) ?? null;
  const deltaUtb = config?.delta_utb?.[contexte?.isolation];
  const uOpaques = FAMILLES_OPAQUES.map(([famille, label]) => {
    // pieceId null : on veut la valeur de FAMILLE, aucune exception par pièce ne peut matcher.
    const valeur = resoudUFamille(compositions, famille, null, { uDefauts: data?.uDefauts, annee });
    const mode = compositions?.familles?.[famille]?.mode;
    return { famille, label, valeur, source: mode === 'defaut' ? `défaut « ${periode} »` : 'saisi' };
  });
  const uMenuiseries = FAMILLES_MENUISERIES.map(([famille, label]) => ({
    famille,
    label,
    valeur: compositions?.familles?.[famille]?.u ?? null,
    source: 'saisi',
  }));
  const exceptions = compositions?.exceptions ?? {};
  return {
    periode,
    plage: PLAGES_VRAISEMBLANCE[periode] ?? null,
    thetaE: { valeur: thetaE, force: Number.isFinite(contexte?.thetaEForce) },
    dju: { valeur: contexte?.dju ?? null, fallback: !!contexte?.djuFallback },
    altitude: contexte?.altitude ?? null,
    isolation: { cle: contexte?.isolation ?? null, label: ISOLATION_LABELS[contexte?.isolation] ?? '—' },
    plancherBas: PLANCHER_BAS_LABELS[saisie?.plancherBasType] ?? '—',
    toiture: TOITURE_LABELS[saisie?.toitureType] ?? '—',
    ventilation: {
      label: systeme?.nom ?? contexte?.typeVentilation ?? '—',
      mode: systeme?.mode ?? null,
      rendement: systeme?.rendement ?? 0,
      facteurDebit: systeme?.facteurDebit ?? null,
    },
    deltaUtb: Number.isFinite(deltaUtb) ? deltaUtb : null,
    fRH: { actif: !!contexte?.relance, valeur: config?.f_rh ?? null },
    foisonnement: Number.isFinite(etude?.foisonnement) ? etude.foisonnement : (config?.foisonnement_emetteur ?? 1),
    u: [...uOpaques, ...uMenuiseries],
    nbExceptions: Object.keys(exceptions.parois ?? {}).length + Object.keys(exceptions.ouvertures ?? {}).length,
  };
}

/**
 * Modèle complet consommé par les pages PDF.
 * @param {object} etude       état wizard (contexte / saisie / compositions / pac / foisonnement)
 * @param {object} resultats   { bilan, thetaE, pac, engineVersion } — LIVE (buildEtudeModel) ou
 *   FIGÉ (savedResults d'une étude rouverte). Le PDF affiche donc toujours les chiffres de l'écran.
 * @param {{ config, data, machine, dateLabel, clientName }} env
 */
export function buildRapportModel(etude, resultats, { config, data, machine = null, dateLabel = '', clientName = '' }) {
  const { bilan, thetaE, pac, engineVersion } = resultats;
  const hypotheses = hypothesesRapport(etude, { config, data, thetaE });
  return {
    projet: {
      titre: etude?.contexte?.titre || 'Étude thermique',
      clientName,
      commune: etude?.contexte?.commune?.nom ?? null,
      codePostal: etude?.contexte?.commune?.cp ?? null, // communes.json : { nom, insee, dept, cp, … }
      dept: etude?.contexte?.dept ?? null,
      altitude: etude?.contexte?.altitude ?? null,
      annee: etude?.contexte?.annee ?? null,
      periode: hypotheses.periode,
      dateLabel,
      engineVersion: engineVersion ?? null,
    },
    synthese: {
      totalW: bilan?.total ?? 0,
      fourchette: bilan?.fourchette ?? null,
      ratioWm2: bilan?.ratioWm2 ?? 0,
      gv: bilan?.gv ?? null,
      thetaE,
      alerteVraisemblance: !!bilan?.alerteVraisemblance,
      plage: hypotheses.plage,
      postes: postesRapport(bilan),
    },
    pieces: piecesRapport(bilan),
    pac: pac
      ? {
        ...pac,
        regime: etude?.pac?.regime ?? null,
        prixKwh: etude?.pac?.prixKwh ?? config?.prix_kwh ?? null,
        machineLabel: machine
          ? `${machine.fabricant} — ${machine.modele}`
          : (etude?.pac?.mode === 'manuelle' ? 'Points constructeur saisis' : null),
        courbe: courbeBivalence({
          bilan, thetaE, thetaNC: config?.theta_non_chauffage, pac: etude?.pac, machine,
        }),
      }
      : null,
    hypotheses,
  };
}
