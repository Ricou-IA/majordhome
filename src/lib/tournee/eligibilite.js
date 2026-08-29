// src/lib/tournee/eligibilite.js
// ============================================================================
// Score d'éligibilité d'un contrat à une date. Module PUR.
// Testé : node --test scripts/tournee/eligibilite.test.mjs
//
// Deux pénalités CONTINUES, jamais une intersection d'ensembles (cf. spec §3.3) :
//   - maturité : distance à la date anniversaire, plateau sur ± toleranceMois ;
//   - saison   : un mois défavorable pénalise fortement, sans annuler.
// Un poêle d'anniversaire janvier ressort ainsi naturellement en octobre ou
// avril, sans règle d'exception à maintenir.
// ============================================================================

const PENALITE_PAR_MOIS_HORS_TOLERANCE = 0.18;
const PLANCHER_MATURITE = 0.1;
const FACTEUR_SAISON_DEFAVORABLE = 0.25;
const BONUS_MOIS_CREUX = 1.3;

/** Distance circulaire entre deux mois (1-12), de 0 à 6. */
export function ecartMois(moisA, moisB) {
  const brut = Math.abs(moisA - moisB);
  return Math.min(brut, 12 - brut);
}

/**
 * Écart SIGNÉ anniversaire -> cible, ramené dans (-6, 6] : POSITIF quand
 * l'anniversaire est encore à venir cette année (fenêtre pas ouverte),
 * NÉGATIF quand il est déjà passé (fenêtre en train de se refermer ou
 * fermée). `|ecartSigne(...)| === ecartMois(...)` toujours — même distance
 * circulaire, la direction en plus. C'est cette identité qui garantit que
 * `estEnRetard` ci-dessous ne chevauche JAMAIS `dansTolerance`
 * (`ecartMois(...) <= toleranceMois`, cf. `scoreEligibilite`) : l'un exige
 * `ecartSigne < -toleranceMois`, l'autre `|ecartSigne| <= toleranceMois` —
 * disjoints, y compris pile sur le mois-bord (I1.2).
 */
export function ecartSigne(moisAnniversaire, moisCible) {
  const brut = moisAnniversaire - moisCible;
  return (((brut + 5) % 12) + 12) % 12 - 5;
}

/**
 * Un contrat est en retard quand SA fenêtre (anniversaire ± toleranceMois)
 * est déjà refermée — une notion ORIENTÉE dans le temps, jamais une distance
 * symétrique : `ecartMois` répond à « combien de mois d'écart », peu importe
 * le sens, ce qui comptait aussi bien un anniversaire dans 4 mois (fenêtre
 * pas encore ouverte) qu'un anniversaire vieux de 4 mois (vraiment en
 * retard) — défaut I1.1 mesuré en prod (~75 % des contrats dus étiquetés
 * retardataires, chiffre inexploitable).
 *
 * Ne dit RIEN sur un contrat sans date anniversaire — cf. `retardStatus`,
 * qui traite ce cas à part plutôt que de le laisser échouer un test tronqué
 * (I1.4).
 *
 * @param {number} moisAnniversaire  1-12
 * @param {number} moisCible         1-12 (mois courant)
 * @param {number} [toleranceMois=2]  reglages.tolerance_anniversaire_mois — jamais en dur (I1.3)
 * @returns {boolean}
 */
export function estEnRetard(moisAnniversaire, moisCible, toleranceMois = 2) {
  return ecartSigne(moisAnniversaire, moisCible) < -toleranceMois;
}

/**
 * Statut retard d'un candidat, pour l'écran (AlertesTournees — le filet
 * « personne n'est oublié », spec §3.7) : distingue explicitement un contrat
 * EN RETARD d'un contrat SANS DATE anniversaire connue. Les deux doivent
 * apparaître dans la liste — ce sont même les SANS DATE les plus exposés à
 * l'oubli, puisqu'ils n'ont structurellement aucune fenêtre à surveiller —
 * mais avec une mention distincte, jamais confondue avec un vrai retard
 * (I1.4).
 *
 * @param {number|null} moisAnniversaire  `null` si `start_date` absente
 * @param {number} moisCible
 * @param {number} [toleranceMois=2]
 * @returns {'en_retard'|'sans_date'|null}  `null` = pas retardataire
 */
export function retardStatus(moisAnniversaire, moisCible, toleranceMois = 2) {
  if (moisAnniversaire == null) return 'sans_date';
  return estEnRetard(moisAnniversaire, moisCible, toleranceMois) ? 'en_retard' : null;
}

/**
 * @param {number} moisAnniversaire  1-12
 * @param {number} moisCible         1-12
 * @param {number[]} moisDefavorables  mois où l'appareil doit être froid
 * @param {number} toleranceMois     plateau autour de l'anniversaire (défaut 2)
 * @param {number[]} moisCreux       mois structurellement vides en entretien
 * @param {boolean} estSaisonnier    le type a-t-il des contraintes de saison
 */
export function scoreEligibilite({
  moisAnniversaire,
  moisCible,
  moisDefavorables = [],
  toleranceMois = 2,
  moisCreux = [],
  estSaisonnier = false,
}) {
  const ecart = ecartMois(moisAnniversaire, moisCible);
  const dansTolerance = ecart <= toleranceMois;

  const maturite = dansTolerance
    ? 1
    : Math.max(PLANCHER_MATURITE, 1 - (ecart - toleranceMois) * PENALITE_PAR_MOIS_HORS_TOLERANCE);

  const saisonDefavorable = moisDefavorables.includes(moisCible);
  const facteurSaison = saisonDefavorable ? FACTEUR_SAISON_DEFAVORABLE : 1;

  // Un type sans contrainte de saison est poussé vers les mois creux : les y
  // laisser libère avril-octobre pour la combustion, qui n'a que sept mois.
  const bonusCreux = !estSaisonnier && moisCreux.includes(moisCible);
  const facteurCreux = bonusCreux ? BONUS_MOIS_CREUX : 1;

  return {
    score: maturite * facteurSaison * facteurCreux,
    dansTolerance,
    saisonDefavorable,
    bonusCreux,
  };
}
