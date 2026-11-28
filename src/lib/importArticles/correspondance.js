// src/lib/importArticles/correspondance.js
// Correspondance entre les colonnes d'un fichier importé et les champs d'un article — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/correspondance.test.mjs.
import { CIBLE_IGNORER, CIBLE_A_CHOISIR } from '../importClients/champs.js';
import { CHAMPS_ARTICLE, champArticle, cibleArticleDepuisEntete } from './champs.js';

/**
 * @typedef {{ index: number, entete: string, cible: string, origine: 'fichier_type' | 'synonyme' | 'main' | '' }} ColonneCorrespondance
 * @typedef {ColonneCorrespondance[]} Correspondance
 */

/**
 * Le fichier suit-il le fichier type ? (toutes les en-têtes non vides sont des libellés exacts du catalogue)
 * @param {string[]} entetes
 * @returns {boolean}
 */
function estFichierType(entetes) {
  const noms = (entetes || []).map((e) => String(e ?? '').trim()).filter(Boolean);
  if (noms.length === 0) return false;
  const libelles = new Set(CHAMPS_ARTICLE.map((c) => c.libelle));
  return noms.every((n) => libelles.has(n));
}

/**
 * Propose un champ pour chaque colonne. Un champ déjà pris par une colonne précédente n'est pas reproposé.
 * @param {string[]} entetes
 * @returns {Correspondance}
 */
export function proposerCorrespondanceArticles(entetes) {
  const type = estFichierType(entetes);
  const pris = new Set();
  return (entetes || []).map((brut, index) => {
    const entete = String(brut ?? '');
    if (!entete.trim()) return { index, entete, cible: CIBLE_IGNORER, origine: '' };
    const cle = cibleArticleDepuisEntete(entete);
    if (!cle || pris.has(cle)) return { index, entete, cible: CIBLE_A_CHOISIR, origine: '' };
    pris.add(cle);
    return { index, entete, cible: cle, origine: type ? 'fichier_type' : 'synonyme' };
  });
}

/**
 * Contrôle le choix de l'utilisateur.
 * `avecFournisseur` : fournisseur, référence fournisseur et prix d'achat sont tous trois choisis (la ligne fournisseur
 * de l'article ne se crée qu'à cette condition).
 * @param {Correspondance} c
 * @returns {{ erreurs: string[], aChoisir: number, avecFournisseur: boolean }}
 */
export function validerCorrespondanceArticles(c) {
  const erreurs = [];
  const compte = new Map();
  let aChoisir = 0;
  for (const col of c) {
    if (col.cible === CIBLE_A_CHOISIR) aChoisir += 1;
    else if (champArticle(col.cible)) compte.set(col.cible, (compte.get(col.cible) || 0) + 1);
  }
  for (const [cle, n] of compte) {
    if (n > 1) erreurs.push(`Deux colonnes vont vers « ${champArticle(cle).libelle} » : gardez-en une.`);
  }
  if (!compte.has('designation')) erreurs.push('Indiquez la colonne de la désignation.');
  const avecFournisseur = ['fournisseur', 'ref_fournisseur', 'prix_achat'].every((cle) => compte.has(cle));
  return { erreurs, aChoisir, avecFournisseur };
}

/**
 * Applique la correspondance à une ligne du fichier. Seules les valeurs non vides sont posées ;
 * si deux colonnes visent le même champ, la première valeur non vide l'emporte.
 * @param {{ numero: number, cellules: string[] }} ligne
 * @param {Correspondance} c
 * @returns {{ numero: number, valeurs: Record<string, string> }}
 */
export function appliquerCorrespondanceArticles(ligne, c) {
  const valeurs = {};
  for (const col of c) {
    if (!champArticle(col.cible)) continue;
    const texte = String(ligne.cellules[col.index] ?? '').trim();
    if (texte && !(col.cible in valeurs)) valeurs[col.cible] = texte;
  }
  return { numero: ligne.numero, valeurs };
}
