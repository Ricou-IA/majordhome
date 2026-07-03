// Parseur du TSV `Base de données - Coordonnées des villes.txt` du logiciel Thermique historique.
import { parseFrNumber } from './sourceFiles.js';

// Garde-fous physiques : quelques lignes source ont des colonnes décalées (ex. Westhoffen
// lat=1597, Racquinghem lng=62684). Bornes couvrant la France entière, DOM-TOM compris
// (lat -22 = Nouvelle-Calédonie ... 52 = Dunkerque ; lng -64 = Antilles ... 56 = La Réunion ;
// altitude -10 = polders ... 4900 = sommet du Mont Blanc). Hors bornes -> null.
function inRange(n, min, max) {
  return n != null && n >= min && n <= max ? n : null;
}

/** TSV `Base de données - Coordonnées des villes.txt` → lignes normalisées. */
export function parseCommunesTsv(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) { // skip header
    const c = line.split('\t');
    // index max lu = 8 (DJU) : il faut au moins 9 colonnes, et un code INSEE non vide.
    if (c.length < 9 || !c[1]) continue;
    const insee = c[1].trim();
    rows.push({
      nom: c[0].trim(), insee, dept: insee.slice(0, 2), cp: c[2].trim(),
      lat: inRange(parseFrNumber(c[4]), -22, 52),
      lng: inRange(parseFrNumber(c[5]), -64, 56),
      altitude: inRange(parseFrNumber(c[6]), -10, 4900),
      dju: parseFrNumber(c[8]),
    });
  }
  return rows;
}
