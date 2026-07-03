// Parseur du TSV `Base de données - Coordonnées des villes.txt` du logiciel Thermique historique.
import { parseFrNumber } from './sourceFiles.js';

/** TSV `Base de données - Coordonnées des villes.txt` → lignes normalisées. */
export function parseCommunesTsv(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) { // skip header
    const c = line.split('\t');
    if (c.length < 9 || !c[1]) continue;
    const insee = c[1].trim();
    rows.push({
      nom: c[0].trim(), insee, dept: insee.slice(0, 2), cp: c[2].trim(),
      lat: parseFrNumber(c[4]), lng: parseFrNumber(c[5]),
      altitude: parseFrNumber(c[6]), dju: parseFrNumber(c[8]),
    });
  }
  return rows;
}
