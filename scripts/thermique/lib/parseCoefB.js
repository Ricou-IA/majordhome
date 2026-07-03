// Parseur du fichier Coefficients-b.txt (coefficients b des locaux non chauffés).
import { unquote } from './sourceFiles.js';

/**
 * Lignes : catégorie (texte libre) puis une ou plusieurs lignes "<b>" ou "<b> <description>" ;
 * ligne vide = fin de catégorie. Certaines catégories n'ont qu'une valeur b sans description
 * (ex. "Paroi donnant directement sur l'extérieur" -> "1.00" seul).
 * @returns {{categorie: string, valeurs: {b: number, description: string|null}[]}[]}
 */
export function parseCoefB(text) {
  const cats = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = unquote(raw);
    if (!line) { current = null; continue; }
    const m = line.match(/^([01](?:[.,]\d+)?)(?:\s+(.+))?$/);
    if (m && current) {
      current.valeurs.push({ b: Number(m[1].replace(',', '.')), description: m[2] ? m[2].trim() : null });
    } else if (!m) {
      current = { categorie: line, valeurs: [] };
      cats.push(current);
    }
  }
  return cats.filter((c) => c.valeurs.length > 0);
}
