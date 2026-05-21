/**
 * postgrestUtils.js - Majord'home
 * ============================================================================
 * Helpers pour construire des clauses PostgREST safe vis-a-vis d'inputs
 * utilisateur.
 *
 * Contexte (P0.26) : les services qui exposent une barre de recherche
 * concatenent le terme utilisateur dans des clauses `.or()` du type
 * `first_name.ilike.%${term}%,last_name.ilike.%${term}%`. Si le terme
 * contient `,`, `(`, `)`, `:` ou `*`, le parser PostgREST peut interpreter
 * ces chars comme des separateurs/operators et injecter d'autres filtres
 * dans la requete. Risque concret : utilisateur tape `foo,is_archived.eq.false`
 * et force `is_archived = false` en plus de son ilike → potentiel cross-org
 * (si le client cible n'est pas filtre par org_id ailleurs) ou contournement
 * de filtres legitimes.
 *
 * Solution : nettoyer les chars dangereux avant interpolation. Strip + trim
 * de tout char non-alphanumerique courant. Les utilisateurs perdent la
 * possibilite de chercher `foo,bar` mais ce n'est pas un usage attendu
 * d'une recherche full-text.
 * ============================================================================
 */

/**
 * Sanitize un terme de recherche utilisateur avant interpolation dans une
 * clause PostgREST `.or()` ou `ilike`.
 *
 * Strip les chars PostgREST-significatifs : `,` (separateur), `(` `)` (group),
 * `:` (cast), `*` (wildcard ARRAY/CSV), `\` (escape) ainsi que les `%` non
 * encadrants (anti pattern wildcard injection).
 *
 * Conserve : lettres (Unicode), chiffres, espaces, `-`, `_`, `@`, `.`, `'`.
 *
 * @param {string} term - terme brut saisi par l'utilisateur
 * @returns {string} terme nettoye, vide si input invalide
 */
export function escapePostgrestSearchTerm(term) {
  if (typeof term !== 'string') return '';
  return term
    .replace(/[,()*:\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
