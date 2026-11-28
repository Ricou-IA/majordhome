// scripts/sync-aspirateur.mjs
// Copie les modules PURS de l'aspirateur (src/lib/aspirateur/*.js) vers ops/aspirateur/lib/, pour que le service VPS
// exécute EXACTEMENT les règles de l'écran et des edges. Source unique = src/lib/aspirateur ; ne jamais éditer les
// copies (scripts/aspirateur/edges.test.mjs échoue dès qu'une copie diverge). Usage : node scripts/sync-aspirateur.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODULES_ASPIRATEUR = ['codes', 'domaine', 'recette', 'lecture', 'propositions'];
const SRC = path.join(racine, 'src', 'lib', 'aspirateur');
const DST = path.join(racine, 'ops', 'aspirateur', 'lib');

export const FICHIERS_ASPIRATEUR = MODULES_ASPIRATEUR.map((n) => ({ source: path.join(SRC, `${n}.js`), cible: path.join(DST, `${n}.js`) }));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(DST, { recursive: true });
  for (const { source, cible } of FICHIERS_ASPIRATEUR) writeFileSync(cible, readFileSync(source));
  console.log(`${FICHIERS_ASPIRATEUR.length} fichiers synchronisés vers ops/aspirateur/lib`);
}
