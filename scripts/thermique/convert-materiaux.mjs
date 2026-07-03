// Conversion Composants/<famille>/.../<nom>.txt -> src/apps/thermique/data/materiaux.json
import fs from 'node:fs';
import path from 'node:path';
import { SRC_ROOT, writeDataJson } from './lib/sourceFiles.js';
import { parseMateriau } from './lib/parseMateriau.js';

const root = path.join(SRC_ROOT, 'Composants');
const materiaux = [];
const rejets = [];

function walk(dir, famille) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, famille ?? entry.name);
    else if (entry.name.endsWith('.txt')) {
      // Un .txt à la racine de Composants/ n'a pas de famille : rejet plutôt que famille: null.
      if (famille == null) {
        rejets.push(path.relative(root, p));
        continue;
      }
      const nom = entry.name.replace(/\.txt$/, '');
      const m = parseMateriau(fs.readFileSync(p, 'latin1'), nom, famille);
      if (m) materiaux.push(m);
      else rejets.push(path.relative(root, p));
    }
  }
}
walk(root, null);
materiaux.sort((a, b) => a.famille.localeCompare(b.famille) || a.nom.localeCompare(b.nom));

if (rejets.length) console.warn(`⚠ ${rejets.length} fichiers rejetés (pas de λ) :`, rejets.slice(0, 10));
if (materiaux.length < 100) throw new Error(`Seulement ${materiaux.length} matériaux convertis — parser à vérifier`);

// Doublons (famille, nom) hérités du logiciel source : on les signale sans dédupliquer.
const vus = new Map();
const doublons = [];
for (const m of materiaux) {
  const cle = `${m.famille}§${m.nom}`;
  if (vus.has(cle)) doublons.push(cle);
  else vus.set(cle, m);
}
if (doublons.length) console.warn(`⚠ ${doublons.length} doublons (famille, nom) conservés tels quels :`, doublons);

writeDataJson('materiaux.json',
  {
    source: 'C:\\Thermique\\Composants (bibliothèque du logiciel historique, usage interne)',
    license: 'proprietary-internal',
    note: "nom n'est pas une clé unique (doublons hérités du logiciel source, matériaux présents sous plusieurs familles) ; les champs masseVolumique/capacite à null correspondent à des plages (\"1 200 à 1 800\") ou champs vides de la source",
  },
  { materiaux });
