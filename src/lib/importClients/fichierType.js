// src/lib/importClients/fichierType.js
// Contenu des classeurs téléchargés depuis l'import de clients (fichier type, lignes écartées) — module PUR
// (imports relatifs seulement), testé par scripts/import-clients/fichier-type.test.mjs.
// Ce module ne produit que des feuilles `{ nom, lignes }` ; l'écriture du classeur est dans classeur.js.

import { CHAMPS } from './champs.js';
import { aImporter, LIBELLE_RAISON } from './controles.js';

/**
 * Feuilles du fichier type : « Clients » (la ligne d'en-tête seule, réimportable telle quelle) et « Mode d'emploi ».
 * Aucune ligne d'exemple dans « Clients » : un fichier rempli à moitié n'importerait pas un faux client.
 * @returns {Array<{ nom: string, lignes: string[][] }>}
 */
export function feuillesFichierType() {
  return [
    { nom: 'Clients', lignes: [CHAMPS.map((c) => c.libelle)] },
    {
      nom: "Mode d'emploi",
      lignes: [
        ['Colonne', 'À quoi elle sert', 'Exemple', 'Valeurs admises'],
        ...CHAMPS.map((c) => [c.libelle, c.aide, c.exemple, (c.valeurs || []).join(', ')]),
      ],
    },
  ];
}

/**
 * Feuille des lignes non importées : colonnes d'origine du fichier, puis « Raison ».
 * @param {string[]} entetes en-têtes du fichier
 * @param {Array<{ numero: number, cellules: string[] }>} lignesDuFichier
 * @param {Array<{ numero: number, statut: string, raison: string }>} classees
 * @param {{ importer: Set<number>, ecarter: Set<number> }} choix
 * @returns {{ nom: string, lignes: string[][] }}
 */
export function feuilleLignesEcartees(entetes, lignesDuFichier, classees, choix) {
  const parNumero = new Map(lignesDuFichier.map((l) => [l.numero, l.cellules]));
  const lignes = [[...entetes, 'Raison']];
  for (const l of classees) {
    if (aImporter(l, choix)) continue;
    const cellules = parNumero.get(l.numero) || [];
    lignes.push([...entetes.map((_, i) => cellules[i] ?? ''), LIBELLE_RAISON[l.raison] || l.raison]);
  }
  return { nom: 'Lignes écartées', lignes };
}
