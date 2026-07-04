// Conversion Bibliothèque Parois.txt -> src/apps/thermique/data/parois-types.json
//
// Extraction volontairement MINIMALE : seulement {nom, code, famille, u} par paroi. Les
// compositions complètes (liste de composants/résistances) ne sont PAS reprises ici — elles
// seront reconstruites côté UI à partir de materiaux.json.
//
// Source : install 2024 (règle "per-file newest", cf. sourceFiles.js) — Bibliothèque
// Parois.txt y date d'oct. 2024 (208 Ko, 12 parois) contre sept. 2020 (77 Ko, 5 parois) dans
// C:/Thermique. Même format dans les deux : une table tabulaire courte suivie d'un gros blob
// de sérialisation Excel/VB (tailles de police, couleurs, "#FALSE#"...) sans rapport avec des
// parois (voir commentaires de tête de lib/parseParois.js). Le seuil de garde ci-dessous reste
// à 3 : c'est la réalité d'une bibliothèque utilisateur (petite), pas une limite du parseur.
import { SRC_ROOT_2024, readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseParois } from './lib/parseParois.js';

console.log(`source : ${SRC_ROOT_2024}/Bibliothèque Parois.txt`);
const { parois, rejects } = parseParois(readSource('Bibliothèque Parois.txt', SRC_ROOT_2024));

if (parois.length < 3) {
  throw new Error(`${parois.length} parois seulement — parser à vérifier (la source 2024 en contient 12, cf. commentaires parseParois.js)`);
}

if (rejects.length > 0) {
  console.warn(`⚠ ${rejects.length} bloc(s) paroi rejeté(s) (aucun U trouvé) :`);
  for (const { nom, reason } of rejects) console.warn(`  - "${nom}" : ${reason}`);
}

// Garde-fou physique : U dans [0.05, 8] W/(m².K). Borne basse : parois très isolées ; borne
// haute élargie au-delà des 6.5 de convert-menuiseries.mjs car la source 2024 contient un mur
// enterré non isolé réel ("Mur Ent.", U jour = 6.71 = 1/R, tracé ligne 42 du fichier source).
for (const { nom, u } of parois) {
  if (u <= 0.05 || u >= 8) throw new Error(`Paroi "${nom}" : u=${u} hors bornes [0.05, 8]`);
}

const parFamille = new Map();
for (const { famille } of parois) {
  parFamille.set(famille, (parFamille.get(famille) || 0) + 1);
}
console.log(`✓ ${parois.length} parois extraites, par famille :`);
for (const [famille, n] of parFamille) console.log(`  - ${famille}: ${n}`);

writeDataJson('parois-types.json',
  {
    source: 'C:\\Thermique2\\Bibliothèque Parois.txt (install 2024 ; U extraits, compositions non reprises)',
    license: 'proprietary-internal',
    note: "Extraction minimale {nom, code, famille, u} par paroi. Compositions complètes NON reprises (seront reconstruites côté UI depuis materiaux.json). La source 2024 ne contient que 12 parois réelles au total (208 Ko presque entièrement occupés par un blob de sérialisation Excel/VB sans rapport) : ce n'est pas une limite du parseur. Certains noms sont génériques ('Mur Ext.', 'Mur Ent.'...) : entrées utilisateur réelles de la bibliothèque, conservées telles quelles ('Mur Ent.' = mur enterré non isolé, U jour = 6.71 dans la source).",
  },
  { parois });
