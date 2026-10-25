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

/**
 * Variante de `escapePostgrestSearchTerm` pour une recherche ILIKE : une décimale (« 7,4 » ou « 7.4 ») devient « 7_4 »
 * avant l'échappement, qui retirerait la virgule (« 7 4 » ne trouve jamais « 7,4 kW »). `_` est le joker d'un
 * caractère d'ILIKE et passe l'échappement : « 7_4 » trouve « 7,4 » comme « 7.4 ». Le reste est inchangé.
 *
 * @param {string} term
 * @returns {string}
 */
export function escapeSearchTermKeepingDecimals(term) {
  if (typeof term !== 'string') return '';
  let t = term;
  // deux passes : « 1,5,2 » chevauche (le chiffre du milieu sert aux deux décimales)
  for (let i = 0; i < 2; i += 1) t = t.replace(/(\d)[,.](\d)/g, '$1_$2');
  return escapePostgrestSearchTerm(t);
}

/**
 * Lit toutes les lignes d'une requête PostgREST, page par page, jusqu'à épuisement.
 * Le plafond serveur (`max-rows`, 1000 par défaut) porte sur les LIGNES : sans pagination,
 * un résultat plus long est tronqué en silence. Une page incomplète termine la lecture ;
 * une page pile pleine déclenche la suivante. Toute page en échec lève une erreur explicite
 * (jamais un résultat partiel rendu comme complet). La requête doit avoir un ordre stable.
 *
 * @param {(from: number, to: number) => Promise<{ data: any[] | null, error: any }>} fetchPage
 *   construit et exécute la requête avec `.range(from, to)`
 * @param {number} [pageSize=1000]
 * @param {number} [maxPages=1000] garde-fou anti-boucle
 * @returns {Promise<any[]>}
 */
export async function fetchAllPages(fetchPage, pageSize = 1000, maxPages = 1000) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      const err = new Error(`Lecture paginée interrompue à la page ${page + 1} (${rows.length} lignes déjà lues) : ${error.message ?? error}`);
      err.cause = error;
      throw err;
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`Lecture paginée : plus de ${maxPages} pages, abandon`);
}
