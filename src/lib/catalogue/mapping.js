// src/lib/catalogue/mapping.js
// Correspondance « catégorie du site fournisseur → catégorie Majord'home » (batterie | photovoltaique | exclure).
// Défauts par plateforme + surcharge par fournisseur (`suppliers.category_mapping`, éditée dans le panneau
// Connexion catalogue). Module PUR (copié pour Deno), testé scripts/catalogue/mapping.test.mjs.
// Spec : docs/superpowers/specs/2026-10-24-catalogue-photovoltaique-connexion-generique-design.md § 3.1, § 4.

// `borne_recharge` : catégorie posée par le fournisseur ECOSTAL (commit e4804a7c, 2026-10-24) ; les bornes BayWa
// (E-Mobility) et Domos (borne-de-recharge) la rejoignent plutôt que le photovoltaïque.
export const CIBLES = Object.freeze(['batterie', 'photovoltaique', 'borne_recharge', 'exclure']);
/** Précédence quand un article porte plusieurs catégories (première trouvée gagne). */
const PRECEDENCE = Object.freeze(['exclure', 'batterie', 'borne_recharge', 'photovoltaique']);
/** Clé d'un article sans aucune catégorie sur le site (23 chez Domos le 2026-10-24). */
export const CLE_SANS_CATEGORIE = '(sans categorie)';
/** Clé du défaut « tout le reste ». */
export const CLE_DEFAUT = '*';

export const DEFAUTS_MAPPING = Object.freeze({
  // NetSuite SuiteCommerce (BayWa) : clé = cseg_itemcategory
  suitecommerce: Object.freeze({
    'Battery Storage': 'batterie', 'E-Mobility': 'borne_recharge',
    [CLE_SANS_CATEGORIE]: 'photovoltaique', [CLE_DEFAUT]: 'photovoltaique',
  }),
  // WooCommerce (Domos) : clé = slug de catégorie
  woocommerce: Object.freeze({
    'systeme-de-stockage': 'batterie', 'batteries-ac': 'batterie', 'batteries-dc': 'batterie',
    'accessoires-systeme-de-stockage': 'batterie', 'kits-de-stockage': 'batterie', 'kit-batterie': 'batterie',
    'borne-de-recharge': 'borne_recharge',
    [CLE_SANS_CATEGORIE]: 'photovoltaique', [CLE_DEFAUT]: 'photovoltaique',
  }),
});

/**
 * Cible d'une clé de catégorie : surcharge du fournisseur, sinon défaut de la plateforme, sinon « tout le reste ».
 * @param {string} cle
 * @param {Record<string, string>|null|undefined} mapping
 * @param {Record<string, string>} defauts
 * @returns {string}
 */
function cibleDe(cle, mapping, defauts) {
  const m = mapping?.[cle];
  if (CIBLES.includes(m)) return m;
  const d = defauts?.[cle];
  if (CIBLES.includes(d)) return d;
  return CIBLES.includes(defauts?.[CLE_DEFAUT]) ? defauts[CLE_DEFAUT] : 'photovoltaique';
}

/**
 * Catégorie Majord'home d'un article depuis ses clés de catégorie du site. Précédence quand il en porte
 * plusieurs : exclure > batterie > borne_recharge > photovoltaique. null = exclu.
 * @param {string[]} cles
 * @param {Record<string, string>|null|undefined} mapping surcharge du fournisseur
 * @param {Record<string, string>} defauts DEFAUTS_MAPPING[plateforme]
 * @returns {'batterie'|'photovoltaique'|'borne_recharge'|null}
 */
export function categorieMajordhome(cles, mapping, defauts) {
  const liste = Array.isArray(cles) && cles.length ? cles : [CLE_SANS_CATEGORIE];
  const cibles = liste.map((c) => cibleDe(c, mapping, defauts));
  const gagnante = PRECEDENCE.find((p) => cibles.includes(p)) || 'photovoltaique';
  return gagnante === 'exclure' ? null : gagnante;
}
