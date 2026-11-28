// src/lib/importArticles/fichierType.js
// Contenu des classeurs téléchargés depuis l'import d'articles (fichier type, lignes écartées) — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/fichier-type.test.mjs.
// Ce module ne produit que des feuilles `{ nom, lignes }` ; l'écriture du classeur est dans le composant.

import { CHAMPS_ARTICLE } from './champs.js';
import { aImporter } from './controles.js';

/**
 * Feuilles du fichier type : « Articles » (libellés des dix-huit champs puis une ligne d'exemple, réimportable
 * telle quelle sans rien à choisir) et « Aide » (libellé, à quoi il sert, exemple).
 * @returns {Array<{ nom: string, lignes: string[][] }>}
 */
export function feuillesFichierTypeArticles() {
  return [
    { nom: 'Articles', lignes: [CHAMPS_ARTICLE.map((c) => c.libelle), CHAMPS_ARTICLE.map((c) => c.exemple)] },
    {
      nom: 'Aide',
      lignes: [
        ['Colonne', 'À quoi elle sert', 'Exemple'],
        ...CHAMPS_ARTICLE.map((c) => [c.libelle, c.aide, c.exemple]),
      ],
    },
  ];
}

const RAISONS = {
  sans_designation: 'Désignation manquante',
  ouvrage: "Ouvrage ou composant : l'article n'est pas repris",
};
const MOTIFS = {
  fichier_code: "Même référence interne qu'une ligne plus haut dans le fichier",
  fichier: "Doublon d'une ligne plus haut dans le fichier",
  code: 'Référence interne déjà prise par un article existant',
  ean: 'Même code EAN qu\'un article existant',
  marque_modele: "Même marque et même référence fabricant qu'un article existant",
  ligne_fournisseur: 'Cette référence existe déjà chez ce fournisseur',
  designation: "Même désignation qu'un article existant",
};

/**
 * Pourquoi une ligne n'est pas importée, en clair.
 * @param {{ raison?: string|null, doublon?: { motif: string }|null }} classee
 * @returns {string}
 */
export function raisonAfficheeArticle(classee) {
  if (classee.raison) return RAISONS[classee.raison] || classee.raison;
  if (classee.doublon) return MOTIFS[classee.doublon.motif] || 'Doublon';
  return '';
}

/**
 * Feuille des lignes non importées : colonnes d'origine du fichier, puis « Raison ».
 * @param {string[]} entetes en-têtes du fichier
 * @param {Array<{ numero: number, cellules: string[] }>} lignesDuFichier
 * @param {Array<object>} classees sortie de `classerArticles`
 * @param {Record<number, boolean>} choix
 * @returns {{ nom: string, lignes: string[][] }}
 */
export function feuilleLignesEcarteesArticles(entetes, lignesDuFichier, classees, choix) {
  const parNumero = new Map(lignesDuFichier.map((l) => [l.numero, l.cellules]));
  const lignes = [[...entetes, 'Raison']];
  for (const c of classees) {
    if (aImporter(c, choix)) continue;
    const cellules = parNumero.get(c.numero) || [];
    lignes.push([...entetes.map((_, i) => cellules[i] ?? ''), raisonAfficheeArticle(c)]);
  }
  return { nom: 'Lignes écartées', lignes };
}
