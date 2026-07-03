// Conversion Bibliothèque Parois.txt -> src/apps/thermique/data/parois-types.json
//
// Extraction volontairement MINIMALE : seulement {nom, code, famille, u} par paroi. Les
// compositions complètes (liste de composants/résistances) ne sont PAS reprises ici — elles
// seront reconstruites côté UI à partir de materiaux.json.
//
// ⚠ Le fichier source (77 Ko) est presque entièrement occupé par un blob de sérialisation
// Excel/VB (tailles de police, couleurs, "#FALSE#"...) sans rapport avec des parois : la table
// tabulaire réelle ne fait que 67 lignes et ne contient que 5 blocs paroi au total (voir
// commentaires de tête de lib/parseParois.js). Le seuil de garde ci-dessous est donc fixé à 3
// (pas 20 comme envisagé avant inspection du fichier réel) : c'est la réalité de la source, pas
// une limite du parseur — voir le rapport de la tâche pour la vérification détaillée.
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseParois } from './lib/parseParois.js';

const { parois, rejects } = parseParois(readSource('Bibliothèque Parois.txt'));

if (parois.length < 3) {
  throw new Error(`${parois.length} parois seulement — parser à vérifier (fichier réel n'en contient que 5 au total, cf. commentaires parseParois.js)`);
}

if (rejects.length > 0) {
  console.warn(`⚠ ${rejects.length} bloc(s) paroi rejeté(s) (aucun U trouvé) :`);
  for (const { nom, reason } of rejects) console.warn(`  - "${nom}" : ${reason}`);
}

// Garde-fou physique : U dans [0.05, 6] W/(m².K), cohérent avec les bornes ug/uf utilisées par
// convert-menuiseries.mjs (élargies vers le bas pour couvrir des parois très isolées).
for (const { nom, u } of parois) {
  if (u <= 0.05 || u >= 6) throw new Error(`Paroi "${nom}" : u=${u} hors bornes [0.05, 6]`);
}

const parFamille = new Map();
for (const { famille } of parois) {
  parFamille.set(famille, (parFamille.get(famille) || 0) + 1);
}
console.log(`✓ ${parois.length} parois extraites, par famille :`);
for (const [famille, n] of parFamille) console.log(`  - ${famille}: ${n}`);

writeDataJson('parois-types.json',
  {
    source: 'C:\\Thermique\\Bibliothèque Parois.txt (U extraits, compositions non reprises)',
    license: 'proprietary-internal',
    note: "Extraction minimale {nom, code, famille, u} par paroi. Compositions complètes NON reprises (seront reconstruites côté UI depuis materiaux.json). Le fichier source ne contient que 5 parois réelles au total (77 Ko presque entièrement occupés par un blob de sérialisation Excel/VB sans rapport) : ce n'est pas une limite du parseur.",
  },
  { parois });
