/**
 * ficheClientOnglets.js — onglets de la fiche client (module PUR, testé :
 * node --test scripts/fiche-client-onglets.test.mjs).
 *
 * Refonte UI phase 3 : neuf onglets regroupés en six. Les anciens identifiants
 * restent reçus (lien `navigate('/clients/:id', { state: { tab } })`, par exemple
 * `tab: 'contract'` au retour de la signature d'un contrat) : `ongletDeDepart`
 * les ramène à l'onglet qui contient désormais leur contenu.
 */

/** Onglets de la fiche, dans l'ordre de la barre. */
export const ONGLETS = ['resume', 'contrat', 'equipements', 'interventions', 'devis-factures', 'echanges'];

/** Libellé affiché de chaque onglet. */
export const LIBELLE_ONGLET = {
  resume: 'Résumé',
  contrat: 'Contrat',
  equipements: 'Équipements',
  interventions: 'Interventions',
  'devis-factures': 'Devis et factures',
  echanges: 'Échanges',
};

/** Ancien identifiant d'onglet (avant le regroupement) → onglet qui le contient. */
const ANCIENS_ONGLETS = new Map([
  ['info', 'resume'],
  ['contract', 'contrat'],
  ['equipments', 'equipements'],
  ['interventions', 'interventions'],
  ['devis-pl', 'devis-factures'],
  ['factures-pl', 'devis-factures'],
  ['timeline', 'echanges'],
  ['mailings', 'echanges'],
  ['sms', 'echanges'],
]);

/**
 * Onglet ouvert à l'arrivée sur la fiche.
 * @param {string} [etat] - `location.state?.tab` : ancien ou nouvel identifiant
 * @returns {string} un identifiant de `ONGLETS` ; Résumé si absent ou inconnu
 */
export function ongletDeDepart(etat) {
  if (ONGLETS.includes(etat)) return etat;
  return ANCIENS_ONGLETS.get(etat) || 'resume';
}

/**
 * Onglet affiché : celui de l'URL (`?onglet=`, brief UX P1-11 — un rechargement ou le bouton
 * Retour restaure l'onglet, un lien peut viser `/clients/:id?onglet=devis-factures`), sinon
 * celui transmis par la navigation (`location.state.tab`), sinon Résumé.
 * @param {{ url?: string|null, etat?: string }} p
 */
export function ongletActif({ url = null, etat } = {}) {
  return url ? ongletDeDepart(url) : ongletDeDepart(etat);
}
