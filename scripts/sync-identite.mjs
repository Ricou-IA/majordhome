// scripts/sync-identite.mjs
// Copie le module de règles de l'identité (src/lib/organisation/identite.js) dans HésiaSun, tel quel.
// Majord'home est la source : on n'édite jamais la copie. À lancer après toute modification du module
// (et après avoir incrémenté VERSION_IDENTITE), puis commiter côté HésiaSun.
//   npm run sync:identite            → écrit la copie
//   npm run sync:identite -- --check → échoue si la copie diffère (rien n'est écrit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(racine, 'src/lib/organisation/identite.js');
const cible = path.resolve(racine, '../Solaire/apps/web/src/lib/organization/identite-partagee.js');
const verifier = process.argv.includes('--check');

if (!fs.existsSync(path.dirname(cible))) {
  console.error(`Dépôt HésiaSun introuvable (${path.dirname(cible)}) : rien n'est copié.`);
  process.exit(verifier ? 0 : 1);
}

// Fins de ligne neutralisées : les deux dépôts n'ont pas forcément le même réglage git.
const lire = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : null);
const attendu = lire(source);
const actuel = lire(cible);

if (attendu === actuel) {
  console.log('✅ Copie HésiaSun à jour.');
} else if (verifier) {
  console.error('❌ La copie HésiaSun diffère du module de Majord\'home : lancer `npm run sync:identite`.');
  process.exit(1);
} else {
  fs.writeFileSync(cible, attendu);
  console.log(`✅ Copié vers ${cible}`);
}
