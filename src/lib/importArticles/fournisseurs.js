// src/lib/importArticles/fournisseurs.js
// Rapprochement des fournisseurs nommés dans le fichier avec ceux de l'entreprise — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/fournisseurs.test.mjs.
// Un fournisseur n'est jamais pris dans une autre organisation : `existants` est la liste de la seule entreprise.

/** Formes juridiques retirées de la clé (jetons entiers seulement). */
const FORMES_JURIDIQUES = new Set(['sarl', 'sas', 'sasu', 'sa', 'eurl', 'snc', 'sci', 'scop']);

/** Sans accent, casse, point ni apostrophe ; le reste de la ponctuation devient un espace. */
function nettoyer(nom) {
  return String(nom ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Clé de comparaison d'un nom de fournisseur : sans accents, casse ni ponctuation, formes juridiques retirées,
 * espaces réduits. Un nom qui ne serait que une forme juridique garde sa forme (jamais de clé vide).
 * @param {unknown} nom
 * @returns {string}
 */
export function cleFournisseur(nom) {
  const propre = nettoyer(nom);
  const sansForme = propre.split(' ').filter((j) => j && !FORMES_JURIDIQUES.has(j)).join(' ');
  return sansForme || propre;
}

/**
 * Pour chaque fournisseur distinct du fichier (par clé), celui de l'entreprise qu'il désigne, sinon « à créer ».
 * @param {Array<string|null|undefined>} noms noms lus dans le fichier
 * @param {Array<{ id: string, name: string }>} existants fournisseurs de l'entreprise
 * @returns {Array<{ nom: string, cle: string, supplierId: string|null, aCreer: boolean }>}
 */
export function rapprocherFournisseurs(noms, existants) {
  const parCle = new Map();
  for (const e of existants || []) {
    const cle = cleFournisseur(e.name);
    if (cle && !parCle.has(cle)) parCle.set(cle, e.id);
  }
  const vus = new Set();
  const resultat = [];
  for (const brut of noms || []) {
    const nom = String(brut ?? '').trim();
    const cle = cleFournisseur(nom);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    const supplierId = parCle.get(cle) ?? null;
    resultat.push({ nom, cle, supplierId, aCreer: supplierId === null });
  }
  return resultat;
}
