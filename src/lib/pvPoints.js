// src/lib/pvPoints.js
// ============================================================================
// Points du PV de réception : gabarits par type d'installation, déclaration de l'entreprise
// (oui / non / sans objet) et confirmation du client. Règles PURES partagées par l'écran et
// l'edge `chantier-pv` (copie Deno générée par `npm run sync:tournee-engine`, ne jamais
// éditer la copie).
// Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
//
// ⚠ Ce fichier doit rester exécutable sous Deno : pas d'import, pas d'alias Vite.
// ⚠ Textes PDF-safe (Helvetica) : apostrophes droites, pas de flèche ni d'espace fine.
// Textes proposés, à relire par Eric et Philippe.
// Testé : node --test scripts/pv-points.test.mjs
// ============================================================================

/** Gabarit par défaut : les points communs seuls. */
export const GABARIT_GENERIQUE = 'generique';

/** Liste fermée des gabarits, le générique en dernier. */
export const GABARITS_RECEPTION = Object.freeze([
  'poele_granules',
  'poele_buches',
  'pac_air_air',
  'pac_air_eau',
  'chauffe_eau',
  GABARIT_GENERIQUE,
]);

/** Libellé de chaque gabarit pour l'écran. */
export const LIBELLES_GABARIT = Object.freeze({
  poele_granules: 'Poêle à granulés',
  poele_buches: 'Poêle à bois ou insert',
  pac_air_air: 'Climatisation, PAC air / air',
  pac_air_eau: 'PAC air / eau',
  chauffe_eau: 'Chauffe-eau',
  generique: 'Générique',
});

/** Réponses possibles de l'entreprise à un point de sa déclaration. */
export const REPONSES_ENTREPRISE = Object.freeze(['oui', 'non', 'sans_objet']);

/** Libellé affiché de chaque réponse de l'entreprise. */
export const LIBELLE_REPONSE = Object.freeze({
  oui: 'oui',
  non: 'non',
  sans_objet: 'sans objet',
});

/** Garanties rappelées sur le PV, toutes à compter de la signature. */
export const GARANTIES_RECEPTION = Object.freeze([
  'Garantie de parfait achèvement : pendant 1 an à compter de la signature de ce procès-verbal, nous reprenons les défauts signalés.',
  'Garantie de bon fonctionnement : pendant 2 ans à compter de la signature de ce procès-verbal, les éléments dissociables de l\'installation sont couverts.',
  'Garantie décennale : pendant 10 ans à compter de la signature de ce procès-verbal, les dommages qui compromettent la solidité de l\'ouvrage ou le rendent impropre à son usage sont couverts.',
]);

const p = (cle, texte) => Object.freeze({ cle, texte });

const COMMUNS_CLIENT = [
  p('c_notice', 'J\'ai reçu la notice d\'utilisation en français.'),
  p('c_demonstration', 'L\'appareil a été mis en marche devant moi et son fonctionnement m\'a été expliqué.'),
  p('c_entretien', 'On m\'a expliqué l\'entretien à prévoir et sa fréquence.'),
];

const COMMUNS_ENTREPRISE = [
  p('e_mise_en_service', 'L\'installation a été mise en service et essayée.'),
  p('e_conforme_devis', 'Les travaux réalisés correspondent au devis.'),
];

const AMENEE_AIR = p('c_amenee_air', 'On m\'a expliqué que l\'arrivée d\'air doit rester dégagée et ne pas être modifiée.');
const CONDUIT = p('e_conduit', 'Le conduit de fumée a été contrôlé et porte sa plaque signalétique.');
const DISTANCES = p('e_distances', 'Les distances de sécurité aux matériaux combustibles sont respectées.');
const DIFFERENTIEL = p('e_differentiel', 'L\'alimentation électrique est protégée par un interrupteur différentiel 30 mA.');
const ETANCHEITE = p('e_etancheite', 'Le circuit frigorifique a été contrôlé étanche et tiré au vide avant la mise en service.');
const FLUIDE = p('e_fluide', 'L\'unité extérieure porte l\'étiquette indiquant la nature et la quantité de fluide.');

// Points propres à chaque gabarit, ajoutés après les communs.
const PROPRES = {
  poele_granules: {
    client: [
      p('c_combustible', 'On m\'a indiqué quels granulés utiliser (certifiés, secs, sans poussière).'),
      AMENEE_AIR,
    ],
    entreprise: [
      CONDUIT,
      DISTANCES,
      p('e_reglages', 'Les réglages de combustion ont été faits (alimentation en granulés, extraction des fumées).'),
      DIFFERENTIEL,
    ],
  },
  poele_buches: {
    client: [
      p('c_combustible', 'On m\'a indiqué quel bois brûler (bûches sèches, de taille adaptée au foyer).'),
      AMENEE_AIR,
    ],
    entreprise: [CONDUIT, DISTANCES],
  },
  pac_air_air: {
    client: [
      p('c_reglages', 'On m\'a montré la télécommande, les modes et le réglage de la température.'),
      p('c_filtres', 'On m\'a montré comment nettoyer les filtres des unités intérieures.'),
    ],
    entreprise: [
      ETANCHEITE,
      FLUIDE,
      p('e_condensats', 'Les condensats s\'évacuent correctement.'),
      DIFFERENTIEL,
    ],
  },
  pac_air_eau: {
    client: [
      p('c_reglages', 'On m\'a montré le thermostat et les réglages du chauffage.'),
      p('c_dimensionnement', 'On m\'a expliqué pourquoi cette puissance a été retenue pour mon logement.'),
    ],
    entreprise: [
      ETANCHEITE,
      FLUIDE,
      p('e_hydraulique', 'Le circuit de chauffage a été rempli, purgé et mis en pression.'),
      DIFFERENTIEL,
    ],
  },
  chauffe_eau: {
    client: [p('c_reglages', 'On m\'a montré les modes de fonctionnement et le réglage de la température.')],
    entreprise: [
      p('e_securite', 'Le groupe de sécurité est posé et raccordé à l\'évacuation.'),
      DIFFERENTIEL,
    ],
  },
};

/**
 * Ramène un code de gabarit à un gabarit connu.
 * @param {string | null | undefined} code
 * @returns {string} le code s'il est connu, sinon `'generique'`
 */
export function normaliserGabarit(code) {
  return GABARITS_RECEPTION.includes(code) ? code : GABARIT_GENERIQUE;
}

/**
 * Points d'un gabarit : communs d'abord, puis propres, dans l'ordre de la spécification.
 * @param {string | null | undefined} code
 * @returns {{ gabarit: string, client: { cle: string, texte: string }[], entreprise: { cle: string, texte: string }[] }}
 */
export function pointsDuGabarit(code) {
  const gabarit = normaliserGabarit(code);
  const propres = PROPRES[gabarit] || { client: [], entreprise: [] };
  return {
    gabarit,
    client: [...COMMUNS_CLIENT, ...propres.client],
    entreprise: [...COMMUNS_ENTREPRISE, ...propres.entreprise],
  };
}

/**
 * Vrai si chaque point de l'entreprise a une réponse valide (rien n'est supposé).
 * @param {string | null | undefined} code
 * @param {Record<string, string> | null | undefined} reponses
 * @returns {boolean}
 */
export function declarationComplete(code, reponses) {
  const r = reponses || {};
  return pointsDuGabarit(code).entreprise.every((pt) => REPONSES_ENTREPRISE.includes(r[pt.cle]));
}

/**
 * Fige la déclaration de l'entreprise : texte repris du module, jamais de la requête.
 * @param {string | null | undefined} code
 * @param {Record<string, string> | null | undefined} reponses
 * @returns {{ ok: true, points: { cle: string, texte: string, reponse: string }[] } | { ok: false, code: 'declaration_incomplete' | 'point_inconnu' }}
 */
export function figerDeclaration(code, reponses) {
  const r = reponses || {};
  const points = pointsDuGabarit(code).entreprise;
  const connues = new Set(points.map((pt) => pt.cle));
  if (Object.keys(r).some((cle) => !connues.has(cle))) return { ok: false, code: 'point_inconnu' };
  if (!declarationComplete(code, r)) return { ok: false, code: 'declaration_incomplete' };
  return { ok: true, points: points.map((pt) => ({ cle: pt.cle, texte: pt.texte, reponse: r[pt.cle] })) };
}

/**
 * Vrai si la déclaration que l'on s'apprête à envoyer est exactement celle déjà enregistrée
 * (mêmes points, mêmes textes, mêmes réponses, dans l'ordre du gabarit) : la préparer à nouveau
 * changerait sa version et ferait refuser la signature du client en `pv_modifie` pour rien.
 * Le gabarit enregistré se compare à part (`pv.gabarit`).
 * @param {string | null | undefined} code
 * @param {Record<string, string> | null | undefined} reponses
 * @param {{ cle: string, texte: string, reponse: string }[] | null | undefined} pointsEnregistres
 * @returns {boolean}
 */
export function memeDeclaration(code, reponses, pointsEnregistres) {
  const decl = figerDeclaration(code, reponses);
  if (!decl.ok || !Array.isArray(pointsEnregistres) || pointsEnregistres.length !== decl.points.length) return false;
  return decl.points.every((pt, i) => {
    const e = pointsEnregistres[i] || {};
    return e.cle === pt.cle && e.texte === pt.texte && e.reponse === pt.reponse;
  });
}

/** Longueur maximale de l'observation de l'installateur (même borne que les réserves du client). */
export const OBSERVATION_MAX = 2000;

/**
 * Observation libre de l'installateur, jointe à sa déclaration (Eric 2026-11-26) : texte sans
 * espaces de bord, `null` si vide ; trop long ⇒ `texte_trop_long`.
 * @param {unknown} texte
 * @returns {{ ok: true, observation: string | null } | { ok: false, code: 'texte_trop_long' }}
 */
export function normaliserObservation(texte) {
  const t = typeof texte === 'string' ? texte.replace(/\r\n?/g, '\n').trim() : '';
  if (t.length > OBSERVATION_MAX) return { ok: false, code: 'texte_trop_long' };
  return { ok: true, observation: t || null };
}

/**
 * Vrai si l'observation saisie est celle déjà enregistrée (vide = absente).
 * @param {unknown} saisie
 * @param {string | null | undefined} enregistree
 * @returns {boolean}
 */
export function memeObservation(saisie, enregistree) {
  const n = normaliserObservation(saisie);
  return n.ok && n.observation === (enregistree || null);
}

/**
 * Fige les points du client : un point non coché est non confirmé.
 * @param {string | null | undefined} code
 * @param {string[] | null | undefined} clesConfirmees
 * @returns {{ ok: true, points: { cle: string, texte: string, confirme: boolean }[] } | { ok: false, code: 'point_inconnu' }}
 */
export function figerPointsClient(code, clesConfirmees) {
  const cles = Array.isArray(clesConfirmees) ? clesConfirmees : [];
  const points = pointsDuGabarit(code).client;
  const connues = new Set(points.map((pt) => pt.cle));
  if (cles.some((cle) => !connues.has(cle))) return { ok: false, code: 'point_inconnu' };
  const confirmees = new Set(cles);
  return { ok: true, points: points.map((pt) => ({ cle: pt.cle, texte: pt.texte, confirme: confirmees.has(pt.cle) })) };
}
